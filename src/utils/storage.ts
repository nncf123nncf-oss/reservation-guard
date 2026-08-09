import type { Reservation } from '../types/reservation.ts'
import { normalizeDateTime, toMinutes } from './overlap.ts'

/** 保存キー。読み込み側と1文字でも違うとデータが消えたように見えるので定数にする */
export const STORAGE_KEY = 'reservation-guard:v1'

/**
 * 読み取れなかったデータの退避先。
 * 読めない値を上書きしてしまうと、あとから手で直すこともできなくなる。
 * 上書きする前に生の文字列をここへ写しておけば、少なくとも中身は残る。
 */
const BACKUP_KEY = 'reservation-guard:v1:backup'

/**
 * localStorage から読んだ値は「他人が書いた壊れたJSON」だと思って扱う。
 * 手で編集された・書き込みの途中で切れた・別バージョンが書いた、のどれもあり得る。
 */
function isReservation(value: unknown): value is Reservation {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    v.id !== '' &&
    typeof v.customerName === 'string' &&
    typeof v.serviceName === 'string' &&
    typeof v.start === 'string' &&
    typeof v.end === 'string' &&
    typeof v.memo === 'string' &&
    (v.status === 'active' || v.status === 'cancelled') &&
    typeof v.createdAt === 'string'
  )
}

/** 日時が読めて、終了が開始より後になっているか */
function hasUsableTimes(item: Reservation): boolean {
  const start = toMinutes(item.start)
  const end = toMinutes(item.end)
  return start !== null && end !== null && end > start
}

export interface LoadResult {
  /** 重なり判定に使える予約 */
  items: Reservation[]
  /**
   * 予約の形はしているが、日時が読めない（または終了が開始より前）もの。
   *
   * 捨てて画面から消すと、その時間帯が「空き」として登録できるようになり、
   * この道具が防ぐはずの二重予約を、そこだけ静かに許してしまう。
   * 判定には使えないが、保存はそのまま続け、画面でも知らせる。
   */
  unreadable: Reservation[]
  /** 保存された文字列そのものが読めなかった */
  failed: boolean
  /** 予約として扱えず捨てた件数（形が違う・idが重複している） */
  discarded: number
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** ローカルの壁掛け時計で `YYYY-MM-DDTHH:mm` を作る（保存する形式と揃える） */
function localDateTime(offsetDays: number, hour: number, minute: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}T${pad(hour)}:${pad(minute)}`
}

/**
 * 最初の1回だけ置くサンプル。実在の顧客の情報は使わない。
 * 日付を固定で書くと数日で全部「過ぎた予約」になってしまうので、開いた日を基準に作る。
 * 2件目は1件目の終了時刻ちょうどから始めてある（隣接は重なりではない、を最初に見せる）。
 */
function createSamples(): Reservation[] {
  const now = new Date().toISOString()
  return [
    {
      id: 'sample-1',
      customerName: 'サンプル 花子',
      serviceName: 'カット',
      start: localDateTime(0, 10, 0),
      end: localDateTime(0, 11, 0),
      memo: '前回と同じ担当をご希望',
      status: 'active',
      createdAt: now,
    },
    {
      id: 'sample-2',
      customerName: 'サンプル 太郎',
      serviceName: 'カラー',
      start: localDateTime(0, 11, 0),
      end: localDateTime(0, 12, 30),
      memo: '',
      status: 'active',
      createdAt: now,
    },
    {
      id: 'sample-3',
      customerName: 'サンプル 桜',
      serviceName: '体験レッスン',
      start: localDateTime(1, 19, 0),
      end: localDateTime(1, 20, 0),
      memo: '初回。持ち物の案内を送る',
      status: 'active',
      createdAt: now,
    },
  ]
}

function emptyResult(items: Reservation[]): LoadResult {
  return { items, unreadable: [], failed: false, discarded: 0 }
}

export function loadReservations(): LoadResult {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    // プライベートモード等で localStorage 自体が使えないことがある
    return emptyResult(createSamples())
  }

  // 一度も使ったことがない場合だけサンプルを出す。
  // 利用者が全部消した状態（"[]"）は尊重し、サンプルを復活させない。
  if (raw === null) return emptyResult(createSamples())

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 書き込みの途中で切れた等。ここで空配列を返すと、
    // 呼び出し側がそれを保存し直した瞬間に元の文字列が失われる。失敗として伝える
    return { items: [], unreadable: [], failed: true, discarded: 0 }
  }

  if (!Array.isArray(parsed)) {
    return { items: [], unreadable: [], failed: true, discarded: 0 }
  }

  const shaped = parsed.filter(isReservation).map((item) => ({
    ...item,
    start: normalizeDateTime(item.start),
    end: normalizeDateTime(item.end),
  }))
  let discarded = parsed.length - shaped.length

  // idの重複はキャンセルや削除の誤爆に直結する。読み込み時に落とす
  const seen = new Set<string>()
  const unique = shaped.filter((item) => {
    if (seen.has(item.id)) {
      discarded += 1
      return false
    }
    seen.add(item.id)
    return true
  })

  const items: Reservation[] = []
  const unreadable: Reservation[] = []
  for (const item of unique) {
    if (hasUsableTimes(item)) items.push(item)
    else unreadable.push(item)
  }

  return { items, unreadable, failed: false, discarded }
}

/**
 * 読み取れなかったときに、生の文字列を退避する。
 * 上書きしてからでは遅いので、読み込んだ直後に1度だけ呼ぶ。
 */
export function backupRaw(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null) localStorage.setItem(BACKUP_KEY, raw)
  } catch {
    // 退避できなくても本体の動作は続ける
  }
}

/**
 * 保存できたかどうかを返す。
 * 黙って失敗すると、利用者は保存されたと信じたまま予約を受け続け、
 * 再読み込みで全部失う。呼び出し側が画面で伝えられるように成否を必ず返す。
 *
 * 判定に使えない予約（unreadable）も一緒に書き戻す。落とすと消えてしまう。
 */
export function saveReservations(
  items: Reservation[],
  unreadable: Reservation[] = [],
): boolean {
  const next = JSON.stringify([...items, ...unreadable])
  try {
    // 中身が同じなら書かない。
    // 他のタブの変更を受け取って画面を更新したときに書き戻すと、
    // 向こうのタブがまた変更を受け取って書き戻し、際限なく往復する
    if (localStorage.getItem(STORAGE_KEY) === next) return true
    localStorage.setItem(STORAGE_KEY, next)
    return true
  } catch {
    // 容量超過・書き込み禁止・プライベートモード
    return false
  }
}

/** idの重複はキャンセルの誤爆に直結するので、衝突しない作り方をする */
export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `rsv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
