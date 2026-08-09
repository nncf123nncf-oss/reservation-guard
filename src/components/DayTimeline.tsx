import type { Reservation } from '../types/reservation.ts'
import {
  describeDate,
  formatTime,
  isOverlapping,
  toMinutes,
} from '../utils/overlap.ts'

interface Candidate {
  start: string
  end: string
}

interface Props {
  /** 帯に映す日（YYYY-MM-DD） */
  anchorDate: string
  reservations: Reservation[]
  /** 入力中の時間帯。まだ時刻が揃っていなければ null */
  candidate: Candidate | null
  todayKey: string
}

const HOUR = 60
/** 何も予約が無い日でも、この時間帯は必ず映す（店を開けている時間の目安） */
const DEFAULT_FROM = 8 * HOUR
const DEFAULT_TO = 21 * HOUR
/**
 * 帯に映す最大の幅。長い予約が1件あるだけで全体が潰れて、
 * 30分の差が1ピクセルも無くなるのを防ぐ。
 * 一番狭い375pxの画面で、track の実幅は約343px。17時間で1時間あたり約20px。
 * これ以上ひろげると、30分の予約が10pxを切って読めなくなる。
 */
const MAX_SPAN = 17 * HOUR

interface Block {
  id: string
  label: string
  from: number
  to: number
  conflict: boolean
}

/**
 * その日の時間の並びを、そのまま横帯にして見せる。
 *
 * 「10:30〜11:30 は重なっています」と文字で言われても、
 * では何時なら空いているのかは結局一覧を追うことになる。
 * 埋まっている所（上段）と入れようとしている所（下段）を同じ物差しの上に並べ、
 * 当たっている区間だけを斜線で縦に貫けば、
 * 「あと1時間うしろなら入る」が読むより先に目に入る。
 */
export function DayTimeline({ anchorDate, reservations, candidate, todayKey }: Props) {
  const dayStart = toMinutes(`${anchorDate}T00:00`)
  if (dayStart === null) return null

  const dayEnd = dayStart + 24 * HOUR

  const candFrom = candidate === null ? null : toMinutes(candidate.start)
  const candTo = candidate === null ? null : toMinutes(candidate.end)
  const hasCandidate = candFrom !== null && candTo !== null && candTo > candFrom

  // その日にかかっている予約だけを拾う。キャンセル済みは枠が空いているので出さない
  const onDay = reservations
    .filter((r) => r.status === 'active')
    .map((r) => ({ r, from: toMinutes(r.start), to: toMinutes(r.end) }))
    .filter(
      (x): x is { r: Reservation; from: number; to: number } =>
        x.from !== null && x.to !== null && x.to > x.from,
    )
    .filter(
      (x) =>
        isOverlapping(x.from, x.to, dayStart, dayEnd) ||
        (hasCandidate && isOverlapping(x.from, x.to, candFrom, candTo)),
    )

  // 映す範囲を決める。既定の8〜21時に、はみ出す予約と入力中の時間帯を足していく
  let lo = dayStart + DEFAULT_FROM
  let hi = dayStart + DEFAULT_TO
  for (const x of onDay) {
    lo = Math.min(lo, x.from)
    hi = Math.max(hi, x.to)
  }
  if (hasCandidate) {
    lo = Math.min(lo, candFrom)
    hi = Math.max(hi, candTo)
  }
  lo = Math.floor(lo / HOUR) * HOUR
  hi = Math.ceil(hi / HOUR) * HOUR

  // 広がりすぎたら、入力中の時間帯のまわりだけに寄せる
  if (hi - lo > MAX_SPAN) {
    if (hasCandidate) {
      lo = Math.floor((candFrom - 2 * HOUR) / HOUR) * HOUR
      hi = Math.ceil((candTo + 2 * HOUR) / HOUR) * HOUR
      // 入力中の予約そのものが長い場合、寄せてもまだ広い。そのときは端を切る
      if (hi - lo > MAX_SPAN) hi = lo + MAX_SPAN
    } else {
      lo = dayStart + DEFAULT_FROM
      hi = dayStart + DEFAULT_TO
    }
  }

  const span = hi - lo
  const pct = (minutes: number) => ((minutes - lo) / span) * 100
  const place = (from: number, to: number) => ({
    left: `${pct(Math.max(from, lo))}%`,
    width: `${pct(Math.min(to, hi)) - pct(Math.max(from, lo))}%`,
  })

  const blocks: Block[] = onDay
    .filter((x) => isOverlapping(x.from, x.to, lo, hi))
    .map((x) => ({
      id: x.r.id,
      label: `${x.r.customerName}／${x.r.serviceName} ${formatTime(
        x.r.start,
      )}〜${formatTime(x.r.end)}`,
      from: x.from,
      to: x.to,
      conflict: hasCandidate && isOverlapping(x.from, x.to, candFrom, candTo),
    }))

  // 重なっている区間そのもの。ここだけ赤い斜線で2段を縦に貫き、被り幅を目で測れるようにする
  const clashes = !hasCandidate
    ? []
    : onDay
        .filter((x) => isOverlapping(x.from, x.to, candFrom, candTo))
        .map((x) => ({
          id: x.r.id,
          from: Math.max(Math.max(x.from, candFrom), lo),
          to: Math.min(Math.min(x.to, candTo), hi),
        }))
        .filter((c) => c.to > c.from)

  // 目盛り。幅に対して細かすぎると線だらけになるので、見出しを出す間隔を変える
  const hours = span / HOUR
  const labelStep = hours <= 8 ? 1 : hours <= 12 ? 2 : 3
  const ticks: { at: number; label: string | null }[] = []
  for (let m = lo; m <= hi; m += HOUR) {
    const hourOfDay = new Date(m * 60_000).getUTCHours()
    const labelled = ((m - lo) / HOUR) % labelStep === 0
    ticks.push({ at: m, label: labelled ? String(hourOfDay) : null })
  }
  const labelled = ticks.filter((t) => t.label !== null)

  const { label, weekday } = describeDate(anchorDate)
  const relative = anchorDate === todayKey ? '今日' : null
  const busyCount = blocks.length

  return (
    <figure
      className="tl"
      role="img"
      aria-label={`${label}${weekday}曜日の時間の空き具合。予約${busyCount}件${
        clashes.length > 0 ? `。入力中の時間帯が${clashes.length}件と重なっています` : ''
      }`}
    >
      <figcaption className="tl-head">
        <span className="tl-date">
          <span className="tl-day">{label}</span>
          <span className="tl-wd">{weekday}</span>
          {relative !== null && <span className="tl-rel">{relative}</span>}
        </span>
        <span className="tl-count num">
          {busyCount === 0 ? '予約なし' : `${busyCount}件`}
        </span>
      </figcaption>

      <div className="tl-track" aria-hidden="true">
        {ticks.map((t) => (
          <span
            key={t.at}
            className={t.label === null ? 'tl-tick' : 'tl-tick is-major'}
            style={{ left: `${pct(t.at)}%` }}
          />
        ))}

        <div className="tl-lanes">
          {/* 上段：もう受けてある予約 */}
          <div className="tl-lane">
            {blocks.map((b) => (
              <span
                key={b.id}
                className={b.conflict ? 'tl-booked is-clash' : 'tl-booked'}
                style={place(b.from, b.to)}
                title={b.label}
              />
            ))}
          </div>

          {/* 下段：いま入れようとしている時間帯 */}
          <div className="tl-lane">
            {hasCandidate && (
              <span
                className={clashes.length > 0 ? 'tl-cand is-clash' : 'tl-cand'}
                style={place(candFrom, candTo)}
              />
            )}
          </div>
        </div>

        {/* 重なりは2段を縦に貫く。上下どちらの都合かではなく「当たっている」ことを示す */}
        {clashes.map((c) => (
          <span
            key={`clash-${c.id}`}
            className="tl-clash"
            style={place(c.from, c.to)}
          />
        ))}
      </div>

      <div className="tl-axis" aria-hidden="true">
        {labelled.map((t, i) => (
          <span
            key={t.at}
            className={[
              'tl-axis-label',
              'num',
              i === 0 ? 'is-first' : '',
              i === labelled.length - 1 ? 'is-last' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ left: `${pct(t.at)}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </figure>
  )
}
