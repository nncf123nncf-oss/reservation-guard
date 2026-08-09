import {
  MAX_DURATION_MINUTES,
  MAX_MEMO_LENGTH,
  MAX_NAME_LENGTH,
  MAX_SERVICE_LENGTH,
  type Reservation,
} from '../types/reservation.ts'

/**
 * このファイルはブラウザの機能（localStorage・DOM）に触れない純粋な計算だけを置く。
 * 重複判定は間違えると「二重予約でお客様を鉢合わせさせる」ため、
 * 画面なしで単体で動かして確かめられる状態を保つ（scripts/check-overlap.ts）。
 */

const DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/** 1分 = 60000ミリ秒 */
const MS_PER_MINUTE = 60_000

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/**
 * `YYYY-MM-DDTHH:mm` を「比較できる数値（分）」に変換する。形式が違えば null。
 *
 * 壁掛け時計の値をそのままUTCとして解釈する。ローカル時刻として解釈すると、
 * 夏時間のある地域では「存在しない時刻」「2回ある時刻」が生まれ、
 * 同じ入力が環境によって別の数値になる。比較する2つを同じ物差しに載せることだけが
 * 目的なので、時差を持ち込まない方が判定は正しくなる。
 */
export function toMinutes(value: string): number | null {
  const matched = DATETIME_PATTERN.exec(value)
  if (!matched) return null

  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  const hour = Number(matched[4])
  const minute = Number(matched[5])

  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  if (hour > 23 || minute > 59) return null

  const ms = Date.UTC(year, month - 1, day, hour, minute)

  // 2026-02-30 のような存在しない日付を Date.UTC は翌月に繰り上げて受け入れてしまう。
  // 戻して一致するか確かめて弾く（年が2桁扱いされる 0050 なども同時に落ちる）。
  const back = new Date(ms)
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day
  ) {
    return null
  }

  return ms / MS_PER_MINUTE
}

/** toMinutes の逆。重なっている時間帯を画面に出すために使う */
export function fromMinutes(minutes: number): string {
  const d = new Date(minutes * MS_PER_MINUTE)
  const p = (n: number, width = 2) => String(n).padStart(width, '0')
  return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(
    d.getUTCDate(),
  )}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

/**
 * 秒つき（`YYYY-MM-DDTHH:mm:ss`）を返すブラウザがあるため、分までに切り詰める。
 * 形式が揺れたまま保存すると、あとから読んだときに判定が静かに落ちる。
 */
export function normalizeDateTime(value: string): string {
  const trimmed = value.trim()
  const matched = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2}(\.\d+)?)?$/.exec(trimmed)
  return matched ? matched[1] : trimmed
}

/**
 * 2つの時間帯が重なっているか。
 *
 * 予約は半開区間 [開始, 終了) として扱う。つまり終了時刻ちょうどは「もう空いている」。
 * 10:00〜11:00 と 11:00〜12:00 は連続して入れたい隣接予約であって、重複ではない。
 * ここを閉区間（<=）にすると、正常な連続予約が毎回はじかれて道具が使い物にならなくなる。
 */
export function isOverlapping(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd
}

export interface OverlapHit {
  reservation: Reservation
  /** 重なっている時間帯そのもの。「何時から何時が被っているか」を画面に出す */
  overlapStart: string
  overlapEnd: string
  overlapMinutes: number
}

/**
 * 登録しようとしている時間帯と重なる既存予約をすべて返す。
 *
 * - キャンセル済みは除外する（枠は空いている）
 * - `excludeId` は自分自身を数えないため。編集時に「自分と重なっています」と言わせない
 * - 1件見つけて打ち切らない。3件重なっているのに1件しか出さないと、
 *   直しても直しても弾かれる状態になり、原因が分からなくなる
 */
export function findOverlaps(
  start: string,
  end: string,
  reservations: Reservation[],
  excludeId?: string,
): OverlapHit[] {
  const startMin = toMinutes(start)
  const endMin = toMinutes(end)
  if (startMin === null || endMin === null || endMin <= startMin) return []

  const hits: OverlapHit[] = []

  for (const target of reservations) {
    if (target.status === 'cancelled') continue
    if (excludeId !== undefined && target.id === excludeId) continue

    const targetStart = toMinutes(target.start)
    const targetEnd = toMinutes(target.end)
    // 壊れた値が混ざっていたら判定できない。安全側に倒して「重なっている」とは言わず飛ばす
    if (targetStart === null || targetEnd === null || targetEnd <= targetStart) continue

    if (!isOverlapping(startMin, endMin, targetStart, targetEnd)) continue

    const from = Math.max(startMin, targetStart)
    const to = Math.min(endMin, targetEnd)
    hits.push({
      reservation: target,
      overlapStart: fromMinutes(from),
      overlapEnd: fromMinutes(to),
      overlapMinutes: to - from,
    })
  }

  return hits.sort((a, b) => a.reservation.start.localeCompare(b.reservation.start))
}

export interface ReservationInput {
  customerName: string
  serviceName: string
  start: string
  end: string
  memo: string
}

/** 項目ごとにエラーを返す。まとめて1行で出すと、スマホではどこが悪いのか分からない */
export type FieldErrors = Partial<Record<keyof ReservationInput, string>>

export function validateInput(input: ReservationInput): FieldErrors {
  const errors: FieldErrors = {}

  const name = input.customerName.trim()
  if (name === '') {
    errors.customerName = 'お客様の名前を入れてください'
  } else if (name.length > MAX_NAME_LENGTH) {
    errors.customerName = `お名前は${MAX_NAME_LENGTH}文字までです`
  }

  const service = input.serviceName.trim()
  if (service === '') {
    errors.serviceName = 'メニュー名を入れてください'
  } else if (service.length > MAX_SERVICE_LENGTH) {
    errors.serviceName = `メニュー名は${MAX_SERVICE_LENGTH}文字までです`
  }

  if (input.memo.length > MAX_MEMO_LENGTH) {
    errors.memo = `メモは${MAX_MEMO_LENGTH}文字までです`
  }

  const startMin = toMinutes(normalizeDateTime(input.start))
  const endMin = toMinutes(normalizeDateTime(input.end))

  if (input.start.trim() === '') {
    errors.start = '開始日時を入れてください'
  } else if (startMin === null) {
    errors.start = '開始日時の形式が正しくありません'
  }

  if (input.end.trim() === '') {
    errors.end = '終了日時を入れてください'
  } else if (endMin === null) {
    errors.end = '終了日時の形式が正しくありません'
  }

  // 前後関係と長さは、両方がちゃんと読めたときだけ見る
  if (startMin !== null && endMin !== null && errors.start === undefined && errors.end === undefined) {
    if (endMin < startMin) {
      errors.end = '終了日時は開始日時より後にしてください'
    } else if (endMin === startMin) {
      errors.end = '終了日時が開始日時と同じです。所要時間を入れてください'
    } else if (endMin - startMin > MAX_DURATION_MINUTES) {
      errors.end = '1件の予約は7日までです。日付の打ち間違いがないか確かめてください'
    }
  }

  return errors
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0
}

/** 日付をまたぐか。またぐ場合だけ画面で知らせて、打ち間違いに気づけるようにする */
export function crossesDate(start: string, end: string): boolean {
  return dateOf(start) !== dateOf(end)
}

/** `2026-08-09T10:00` → `2026-08-09`。日付ごとの見出しをまとめる鍵に使う */
export function dateOf(value: string): string {
  return value.slice(0, 10)
}

/** `2026-08-09T10:00` → `10:00`。一覧では日付を見出しに出すので、行には時刻だけ置く */
export function formatTime(value: string): string {
  const minutes = toMinutes(value)
  if (minutes === null) return value
  const d = new Date(minutes * MS_PER_MINUTE)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(
    d.getUTCMinutes(),
  ).padStart(2, '0')}`
}

/** `2026-08-09` → `8月9日` と `土` に分ける。見出しで大きさを変えて組むため別々に返す */
export function describeDate(dateKey: string): { label: string; weekday: string } {
  const minutes = toMinutes(`${dateKey}T00:00`)
  if (minutes === null) return { label: dateKey, weekday: '' }
  const d = new Date(minutes * MS_PER_MINUTE)
  return {
    label: `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`,
    weekday: WEEKDAYS[d.getUTCDay()],
  }
}

export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0分'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}分`
  if (m === 0) return `${h}時間`
  return `${h}時間${m}分`
}

/** `2026-08-09T10:00` → `8/9(日) 10:00` */
export function formatDateTime(value: string): string {
  const minutes = toMinutes(value)
  if (minutes === null) return value
  const d = new Date(minutes * MS_PER_MINUTE)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${
    WEEKDAYS[d.getUTCDay()]
  }) ${hh}:${mm}`
}

/**
 * 時間帯の表示。日付をまたぐときだけ終了側にも日付を出す。
 * 常に両方に日付を出すとスマホの1行に収まらず、またぐことに気づきにくくなる。
 */
export function formatRange(start: string, end: string): string {
  const endMinutes = toMinutes(end)
  if (endMinutes === null) return `${formatDateTime(start)} 〜 ${end}`
  const d = new Date(endMinutes * MS_PER_MINUTE)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  const tail = crossesDate(start, end)
    ? formatDateTime(end)
    : `${hh}:${mm}`
  return `${formatDateTime(start)} 〜 ${tail}`
}

/** 開始が早い順。同時刻なら登録した順にして、並びが毎回変わらないようにする */
export function sortByStart(reservations: Reservation[]): Reservation[] {
  return [...reservations].sort((a, b) => {
    const byStart = a.start.localeCompare(b.start)
    if (byStart !== 0) return byStart
    return a.createdAt.localeCompare(b.createdAt)
  })
}
