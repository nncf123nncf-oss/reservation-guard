import {
  dateOf,
  formatDateTime,
  formatDuration,
  formatRange,
  formatTime,
  type OverlapHit,
} from '../utils/overlap.ts'
import { IconWarning } from './Icon.tsx'

interface Props {
  hits: OverlapHit[]
}

/**
 * 重なりの詳細を出す唯一の場所。
 *
 * 「この時間帯には別の予約があります」だけでは、利用者は一覧を上から探し直すことになる。
 * 誰の・何の予約と・どこが被っているか、そして何時になれば空くかまで出して、
 * そのまま電話口で「その時間は埋まっていて、12時半以降なら空いています」と言える状態にする。
 */
export function OverlapNotice({ hits }: Props) {
  if (hits.length === 0) return null

  // 一番遅い終了時刻＝そこまで待てば必ず空く時刻。次の提案をこれ1つに絞れる
  const clearAt = hits.reduce(
    (latest, hit) =>
      hit.reservation.end.localeCompare(latest) > 0 ? hit.reservation.end : latest,
    hits[0].reservation.end,
  )

  /*
    「空くのは 02:00 から」とだけ出すと、電話口で当日の午前2時と受け取られる。
    22:00〜翌02:00 の予約に当たったときは、日付まで言わないと予定が食い違う。
    重なっている区間の日付と比べて、日をまたぐときだけ日付を出す。
  */
  const clearsOnAnotherDay = dateOf(clearAt) !== dateOf(hits[0].overlapStart)

  /*
    ここに role="alert" は付けない。
    同じ内容を画面上部の赤い帯が既に読み上げており、
    二重に告げると、時刻を1文字打つたびに同じ文が2回読まれる。
  */
  return (
    <div className="clash">
      <p className="clash-head">
        <IconWarning />
        重なっている予約
        <span className="clash-count num">{hits.length}件</span>
      </p>

      <ul className="clash-list">
        {hits.map((hit) => (
          <li key={hit.reservation.id}>
            <p className="clash-time num">
              {formatRange(hit.reservation.start, hit.reservation.end)}
            </p>
            <p className="clash-who">
              {hit.reservation.customerName}
              <span className="clash-service">{hit.reservation.serviceName}</span>
            </p>
            <p className="clash-span num">
              重なり {formatTime(hit.overlapStart)}〜{formatTime(hit.overlapEnd)}
              <span className="clash-dur">{formatDuration(hit.overlapMinutes)}</span>
            </p>
          </li>
        ))}
      </ul>

      <p className="clash-hint">
        <span className="clash-hint-label">空くのは</span>
        <span className="clash-hint-time num">
          {clearsOnAnotherDay ? formatDateTime(clearAt) : formatTime(clearAt)}
        </span>
        から。時間をずらすか、先の予約をキャンセルしてください。
      </p>
    </div>
  )
}
