import assert from 'node:assert/strict'
import test from 'node:test'
import type { Reservation } from '../src/types/reservation.ts'
import {
  crossesDate,
  findOverlaps,
  formatDuration,
  hasErrors,
  normalizeDateTime,
  toMinutes,
  validateInput,
  type ReservationInput,
} from '../src/utils/overlap.ts'

/**
 * 重複判定の境界を、画面を通さずに確かめる。
 *
 * 画面で1件ずつ試すと、隣接（10-11 と 11-12）のような
 * 「間違えても正しく見えてしまう」ケースを見落とす。ここは目視で確かめない。
 *
 * 実行: npm run check
 */

const DAY = '2026-08-09'

function rsv(
  id: string,
  start: string,
  end: string,
  status: Reservation['status'] = 'active',
): Reservation {
  return {
    id,
    customerName: `テスト${id}`,
    serviceName: 'カット',
    start,
    end,
    memo: '',
    status,
    createdAt: '2026-08-01T00:00:00.000Z',
  }
}

/** 同じ日の hh:mm を作る補助 */
function t(hhmm: string): string {
  return `${DAY}T${hhmm}`
}

function input(over: Partial<ReservationInput> = {}): ReservationInput {
  return {
    customerName: '山田 花子',
    serviceName: 'カット',
    start: t('10:00'),
    end: t('11:00'),
    memo: '',
    ...over,
  }
}

// 台帳にすでに入っている予約：10:00〜11:00
const existing = [rsv('A', t('10:00'), t('11:00'))]

test('完全に重なる予約 — 同じ時間帯は拒否する', () => {
  const hits = findOverlaps(t('10:00'), t('11:00'), existing)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].reservation.id, 'A')
  assert.equal(hits[0].overlapStart, t('10:00'))
  assert.equal(hits[0].overlapEnd, t('11:00'))
  assert.equal(hits[0].overlapMinutes, 60)
})

test('一部だけ重なる予約 — 後ろにずれ込む', () => {
  // 10:30〜11:30。10:30〜11:00 の30分が被る
  const hits = findOverlaps(t('10:30'), t('11:30'), existing)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].overlapStart, t('10:30'))
  assert.equal(hits[0].overlapEnd, t('11:00'))
  assert.equal(hits[0].overlapMinutes, 30)
})

test('一部だけ重なる予約 — 前にずれ込む', () => {
  // 09:30〜10:15。10:00〜10:15 の15分が被る
  const hits = findOverlaps(t('09:30'), t('10:15'), existing)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].overlapMinutes, 15)
})

test('包み込む／包まれる — どちらも重複として拒否する', () => {
  // 新しい予約が既存をまるごと含む
  assert.equal(findOverlaps(t('09:00'), t('12:00'), existing).length, 1)
  // 新しい予約が既存の内側に完全に収まる
  assert.equal(findOverlaps(t('10:15'), t('10:45'), existing).length, 1)
})

test('前後が隣接する予約 — 終了時刻ちょうどからは通す', () => {
  // 09:00〜10:00（既存の直前）
  assert.deepEqual(findOverlaps(t('09:00'), t('10:00'), existing), [])
  // 11:00〜12:00（既存の直後）
  assert.deepEqual(findOverlaps(t('11:00'), t('12:00'), existing), [])
})

test('1分でも食い込めば拒否する — 隣接との境目', () => {
  // 09:00〜10:01
  assert.equal(findOverlaps(t('09:00'), t('10:01'), existing).length, 1)
  // 10:59〜12:00
  assert.equal(findOverlaps(t('10:59'), t('12:00'), existing).length, 1)
})

test('キャンセル済み予約 — 枠は空いているので通す', () => {
  const cancelled = [rsv('A', t('10:00'), t('11:00'), 'cancelled')]
  assert.deepEqual(findOverlaps(t('10:00'), t('11:00'), cancelled), [])
})

test('キャンセル済みと予約中が混在 — 予約中だけを拾う', () => {
  const mixed = [
    rsv('A', t('10:00'), t('11:00'), 'cancelled'),
    rsv('B', t('10:30'), t('11:30')),
  ]
  const hits = findOverlaps(t('10:00'), t('11:00'), mixed)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].reservation.id, 'B')
})

test('日付をまたぐ予約 — 22:00〜翌01:00 を正しく扱う', () => {
  const night = [rsv('N', `${DAY}T22:00`, '2026-08-10T01:00')]

  // 翌00:30〜01:30 は、日付が違っても重なっている
  const hits = findOverlaps('2026-08-10T00:30', '2026-08-10T01:30', night)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].overlapStart, '2026-08-10T00:30')
  assert.equal(hits[0].overlapEnd, '2026-08-10T01:00')
  assert.equal(hits[0].overlapMinutes, 30)

  // 翌01:00〜02:00 は隣接なので通る
  assert.deepEqual(findOverlaps('2026-08-10T01:00', '2026-08-10T02:00', night), [])

  // 前日21:00〜22:00 も隣接なので通る
  assert.deepEqual(findOverlaps(`${DAY}T21:00`, `${DAY}T22:00`, night), [])

  assert.equal(crossesDate(`${DAY}T22:00`, '2026-08-10T01:00'), true)
  assert.equal(crossesDate(t('10:00'), t('11:00')), false)
})

test('月またぎ・年またぎ — 桁が繰り上がっても比較できる', () => {
  const newYear = [rsv('Y', '2026-12-31T23:00', '2027-01-01T01:00')]
  assert.equal(findOverlaps('2027-01-01T00:00', '2027-01-01T02:00', newYear).length, 1)
  assert.deepEqual(findOverlaps('2027-01-01T01:00', '2027-01-01T02:00', newYear), [])
})

test('終了時刻が開始時刻より前 — 入力の時点で止める', () => {
  const errors = validateInput(input({ start: t('11:00'), end: t('10:00') }))
  assert.ok(hasErrors(errors))
  assert.match(errors.end ?? '', /後にしてください/)

  // 判定側も、逆転した時間帯では重複を返さない（不正な入力で登録させない）
  assert.deepEqual(findOverlaps(t('11:00'), t('10:00'), existing), [])
})

test('開始と終了が同じ — 長さゼロの予約は作らせない', () => {
  const errors = validateInput(input({ start: t('10:00'), end: t('10:00') }))
  assert.ok(hasErrors(errors))
  assert.match(errors.end ?? '', /同じ/)
})

test('必須項目 — 空欄はそれぞれの欄にエラーを出す', () => {
  const errors = validateInput(
    input({ customerName: '  ', serviceName: '', start: '', end: '' }),
  )
  assert.ok(errors.customerName)
  assert.ok(errors.serviceName)
  assert.ok(errors.start)
  assert.ok(errors.end)
})

test('正しい入力はエラーなし', () => {
  assert.equal(hasErrors(validateInput(input())), false)
})

test('7日を超える予約 — 年の打ち間違いを弾く', () => {
  // 2026 を 2062 と打った想定
  const errors = validateInput(input({ start: t('10:00'), end: '2062-08-09T11:00' }))
  assert.ok(errors.end)

  // ちょうど7日は通す（境界は含む）
  assert.equal(
    hasErrors(validateInput(input({ start: t('10:00'), end: '2026-08-16T10:00' }))),
    false,
  )
})

test('壊れた日時 — 存在しない日付・形式違いは読まない', () => {
  assert.equal(toMinutes('2026-02-30T10:00'), null) // 2月30日は無い
  assert.equal(toMinutes('2026-13-01T10:00'), null) // 13月
  assert.equal(toMinutes('2026-08-09T25:00'), null) // 25時
  assert.equal(toMinutes('2026-08-09'), null) // 時刻が無い
  assert.equal(toMinutes(''), null)
  assert.equal(toMinutes('0050-08-09T10:00'), null) // 年が2桁扱いされる値
  assert.equal(toMinutes('2026-02-29T10:00'), null) // 2026年は閏年ではない
  assert.ok(toMinutes('2028-02-29T10:00') !== null) // 2028年は閏年
})

test('終了が開始より前の既存予約は判定に使わない', () => {
  // 12:00→09:00 のような逆転した予約が台帳にあっても、判定の材料にはしない。
  // 幅を計算できないため。読み込み側でも items から外している（storage.ts）
  const reversed = [rsv('R', t('12:00'), t('09:00'))]
  assert.deepEqual(findOverlaps(t('10:00'), t('11:00'), reversed), [])
})

test('ちょうど7日は通し、7日と1分は弾く', () => {
  assert.equal(
    hasErrors(validateInput(input({ start: t('10:00'), end: '2026-08-16T10:00' }))),
    false,
  )
  const over = validateInput(input({ start: t('10:00'), end: '2026-08-16T10:01' }))
  assert.ok(over.end)
})

test('壊れた既存予約は判定から外す — ただし通してしまわない', () => {
  const broken = [rsv('X', 'こわれた', 'これも'), rsv('A', t('10:00'), t('11:00'))]
  const hits = findOverlaps(t('10:30'), t('11:30'), broken)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].reservation.id, 'A')
})

test('秒つきの値を分に切り詰める', () => {
  assert.equal(normalizeDateTime('2026-08-09T10:00:00'), t('10:00'))
  assert.equal(normalizeDateTime('2026-08-09T10:00:30.500'), t('10:00'))
  assert.equal(normalizeDateTime(' 2026-08-09T10:00 '), t('10:00'))
})

test('重なる予約が複数あれば全部返す（開始が早い順）', () => {
  const many = [
    rsv('C', t('11:30'), t('12:30')),
    rsv('A', t('09:30'), t('10:30')),
    rsv('B', t('10:45'), t('11:15')),
  ]
  const hits = findOverlaps(t('10:00'), t('12:00'), many)
  assert.deepEqual(
    hits.map((h) => h.reservation.id),
    ['A', 'B', 'C'],
  )
})

test('自分自身は重複に数えない（キャンセルを戻すとき）', () => {
  const hits = findOverlaps(t('10:00'), t('11:00'), existing, 'A')
  assert.deepEqual(hits, [])
})

test('所要時間の表示', () => {
  assert.equal(formatDuration(30), '30分')
  assert.equal(formatDuration(60), '1時間')
  assert.equal(formatDuration(90), '1時間30分')
  assert.equal(formatDuration(180), '3時間')
})
