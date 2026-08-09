import { useEffect, useState } from 'react'
import type { Reservation } from '../types/reservation.ts'
import {
  crossesDate,
  dateOf,
  describeDate,
  formatDuration,
  formatRange,
  formatTime,
  toMinutes,
} from '../utils/overlap.ts'
import { IconCheck, IconCopy, IconEmptyCalendar } from './Icon.tsx'

interface Props {
  /** すでに開始が早い順に並んでいる前提 */
  reservations: Reservation[]
  /** 一覧が空のときに出す理由。「0件」だけだと壊れたのか空なのか分からない */
  emptyMessage: string
  /** 「今」より前かどうかの基準（分）。終わった予約を沈めるために使う */
  nowMinutes: number
  todayKey: string
  onCancel: (id: string) => void
  onRestore: (id: string) => void
  onDelete: (id: string) => void
}

interface DayGroup {
  key: string
  items: Reservation[]
}

/**
 * 日付ごとにまとめる。
 * 1行ごとに「8月9日 10:00」と繰り返すと、同じ文字列が縦に並んで
 * 肝心の時刻の違いが埋もれる。日付は見出しに追い出して、行には時刻だけ残す。
 */
function groupByDate(reservations: Reservation[]): DayGroup[] {
  const groups: DayGroup[] = []
  for (const item of reservations) {
    const key = dateOf(item.start)
    const last = groups[groups.length - 1]
    if (last !== undefined && last.key === key) {
      last.items.push(item)
    } else {
      groups.push({ key, items: [item] })
    }
  }
  return groups
}

/** 予約の内容を、そのまま返信に貼れる形の文にする */
function toPlainText(item: Reservation): string {
  const { label, weekday } = describeDate(dateOf(item.start))
  const lines = [
    `${label}(${weekday}) ${formatRange(item.start, item.end)}`,
    `${item.customerName} 様／${item.serviceName}`,
  ]
  if (item.memo !== '') lines.push(item.memo)
  return lines.join('\n')
}

/**
 * 古いやり方での書き写し。
 * 一度画面の外に置いた入力欄へ文字を入れて選択し、コピーしてから片づける。
 * 見た目に一瞬でも出ないよう、画面の外へ飛ばしたうえで読み上げからも隠す。
 */
function copyByFallback(text: string): boolean {
  const holder = document.createElement('textarea')
  holder.value = text
  holder.setAttribute('readonly', '')
  holder.setAttribute('aria-hidden', 'true')
  holder.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0'
  document.body.appendChild(holder)
  try {
    holder.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    holder.remove()
  }
}

export function ReservationList({
  reservations,
  emptyMessage,
  nowMinutes,
  todayKey,
  onCancel,
  onRestore,
  onDelete,
}: Props) {
  // どの行をコピーしたか。押した本人に結果を返さないと、コピーできたのか分からない
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (copied === null) return
    const timer = setTimeout(() => setCopied(null), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function handleCopy(item: Reservation) {
    const text = toPlainText(item)

    try {
      await navigator.clipboard.writeText(text)
      setCopied(item.id)
      return
    } catch {
      // 新しい方の書き込みは、保護されていない接続（社内のパソコン同士で開いた等）や
      // 許可が下りていない環境では失敗する。ここで諦めず、古い方の手段に落とす
    }

    if (copyByFallback(text)) {
      setCopied(item.id)
      return
    }

    // 黙って何もしないと「押しても反応しない」に見える。できなかったことは必ず返す
    setCopied(`failed:${item.id}`)
  }

  if (reservations.length === 0) {
    return (
      <p className="empty">
        <IconEmptyCalendar size={24} />
        {emptyMessage}
      </p>
    )
  }

  return (
    <div className="ledger">
      {groupByDate(reservations).map((group) => {
        const { label, weekday } = describeDate(group.key)
        return (
          <section className="day" key={group.key}>
            <h3 className="day-head">
              <span className="day-label">{label}</span>
              <span className="day-wd">{weekday}</span>
              {group.key === todayKey && <span className="day-rel">今日</span>}
              <span className="day-rule" aria-hidden="true" />
              <span className="day-count num">{group.items.length}件</span>
            </h3>

            <ul className="rows">
              {group.items.map((item) => {
                const startMin = toMinutes(item.start)
                const endMin = toMinutes(item.end)
                const cancelled = item.status === 'cancelled'
                const past = !cancelled && endMin !== null && endMin <= nowMinutes
                const overnight = crossesDate(item.start, item.end)
                const copyState =
                  copied === item.id
                    ? 'ok'
                    : copied === `failed:${item.id}`
                      ? 'failed'
                      : 'idle'

                return (
                  <li
                    key={item.id}
                    className={[
                      'row',
                      cancelled ? 'is-cancelled' : '',
                      past ? 'is-past' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <div className="row-time num">
                      <span className="t-start">{formatTime(item.start)}</span>
                      <span className="t-bar" aria-hidden="true" />
                      <span className="t-end">
                        {overnight && <span className="t-next">翌</span>}
                        {formatTime(item.end)}
                      </span>
                    </div>

                    <div className="row-body">
                      <p className="row-name">{item.customerName}</p>
                      <p className="row-meta">
                        <span className="row-service">{item.serviceName}</span>
                        {startMin !== null && endMin !== null && (
                          <span className="row-dur">
                            {formatDuration(endMin - startMin)}
                          </span>
                        )}
                      </p>

                      {/* 打ち消し線と薄い色だけに頼らず、状態は必ず文字でも書く */}
                      {(cancelled || past) && (
                        <p className={cancelled ? 'row-state is-off' : 'row-state'}>
                          {cancelled ? 'キャンセル済み' : '終了しました'}
                        </p>
                      )}

                      {item.memo !== '' && <p className="row-memo">{item.memo}</p>}

                      <div className="row-actions">
                        <button
                          type="button"
                          className={copyState === 'ok' ? 'act is-done' : 'act'}
                          onClick={() => void handleCopy(item)}
                        >
                          {copyState === 'ok' ? (
                            <IconCheck size={16} />
                          ) : (
                            <IconCopy size={16} />
                          )}
                          {copyState === 'ok'
                            ? 'コピーしました'
                            : copyState === 'failed'
                              ? 'コピーできませんでした'
                              : '内容をコピー'}
                        </button>

                        {cancelled ? (
                          <>
                            {/*
                              キャンセルは行を消さずに状態で持つ。消してしまうと
                              「誰をいつ断ったか」が残らず、あとで問い合わせが来たときに答えられない
                            */}
                            <button
                              type="button"
                              className="act"
                              onClick={() => onRestore(item.id)}
                            >
                              予約に戻す
                            </button>
                            <button
                              type="button"
                              className="act is-danger"
                              onClick={() => onDelete(item.id)}
                            >
                              削除
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="act"
                            onClick={() => onCancel(item.id)}
                          >
                            予約をキャンセル
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
