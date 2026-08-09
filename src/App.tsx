import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ReservationForm } from './components/ReservationForm.tsx'
import { ReservationList } from './components/ReservationList.tsx'
import { OverlapNotice } from './components/OverlapNotice.tsx'
import { IconCheck, IconWarning, LogoMark } from './components/Icon.tsx'
import type { Reservation } from './types/reservation.ts'
import {
  dateOf,
  findOverlaps,
  hasErrors,
  normalizeDateTime,
  sortByStart,
  toMinutes,
  validateInput,
  type FieldErrors,
  type OverlapHit,
  type ReservationInput,
} from './utils/overlap.ts'
import {
  backupRaw,
  createId,
  loadReservations,
  saveReservations,
  STORAGE_KEY,
} from './utils/storage.ts'
import './App.css'

type Filter = 'active' | 'cancelled' | 'all'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'active', label: '予約中' },
  { value: 'cancelled', label: 'キャンセル済み' },
  { value: 'all', label: 'すべて' },
]

const EMPTY: ReservationInput = {
  customerName: '',
  serviceName: '',
  start: '',
  end: '',
  memo: '',
}

/** 終了時刻を空欄から埋めるときの既定の長さ */
const DEFAULT_MINUTES = 60

/** 「終了しました」の切り替えのために時計を見直す間隔 */
const CLOCK_TICK_MS = 60_000

/** ローカルの壁掛け時計を `YYYY-MM-DDTHH:mm` にする（保存している値と物差しを揃える） */
function wallClockNow(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`
}

function shiftMinutes(value: string, minutes: number): string {
  const base = toMinutes(value)
  if (base === null) return ''
  const d = new Date((base + minutes) * 60_000)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(
    d.getUTCDate(),
  )}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

interface Flash {
  kind: 'ok' | 'alert'
  text: string
}

interface RestoreBlock {
  name: string
  hits: OverlapHit[]
}

function App() {
  // 読み込みは1度だけ。読み取れなかったものがあれば、上書きする前に生の値を退避する
  const [firstLoad] = useState(() => {
    const result = loadReservations()
    if (result.failed || result.discarded > 0 || result.unreadable.length > 0) {
      backupRaw()
    }
    return result
  })

  const [reservations, setReservations] = useState<Reservation[]>(firstLoad.items)
  /** 日時が読めない予約。判定には使えないが、捨てずに保存し続ける */
  const [unreadable, setUnreadable] = useState<Reservation[]>(firstLoad.unreadable)
  const [loadFailed, setLoadFailed] = useState(firstLoad.failed)
  const [discarded, setDiscarded] = useState(firstLoad.discarded)

  // 入力中の内容は画面全体で1つ。ヘッダーの件数・上部の警告・フォームの詳細が
  // 別々に判定すると、同じ画面で違うことを言い出す
  const [draft, setDraft] = useState<ReservationInput>(EMPTY)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [flash, setFlash] = useState<Flash | null>(null)
  const [filter, setFilter] = useState<Filter>('active')
  const [saveFailed, setSaveFailed] = useState(false)
  const [restoreBlock, setRestoreBlock] = useState<RestoreBlock | null>(null)
  // 値そのものは使わない。1分ごとに描き直させるためだけのもの
  const [, tickClock] = useReducer((n: number) => n + 1, 0)

  /*
    最初の描画では保存しない。
    読み取れない値が入っていたとき、開いただけで空の配列に上書きされ、
    元の文字列が取り返しのつかない形で消える。書くのは利用者が何かしたときだけにする。
  */
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    setSaveFailed(!saveReservations(reservations, unreadable))
  }, [reservations, unreadable])

  /*
    他のタブでの変更を受け取る。
    「電話用」と「作業用」で2枚開くのは普通の使い方で、
    受け取らないと、古い画面のまま登録して相手のタブの予約を消してしまう。
  */
  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== null && event.key !== STORAGE_KEY) return
      const latest = loadReservations()
      setReservations(latest.items)
      setUnreadable(latest.unreadable)
      setLoadFailed(latest.failed)
      setDiscarded(latest.discarded)
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  // 開きっぱなしでも「終了しました」が切り替わるように、1分ごとに描き直す
  useEffect(() => {
    const timer = setInterval(tickClock, CLOCK_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const now = wallClockNow()
  const nowMinutes = toMinutes(now) ?? 0
  const todayKey = dateOf(now)

  const start = normalizeDateTime(draft.start)
  const end = normalizeDateTime(draft.end)
  const startMin = toMinutes(start)
  const endMin = toMinutes(end)
  const timesReady = startMin !== null && endMin !== null && endMin > startMin

  /**
   * 登録ボタンを押す前に重なりを見る。
   * 押してから断られるより、時刻を入れた瞬間に「そこは埋まっています」と分かる方が、
   * 電話口でお客様を待たせずに別の時間を出せる。
   */
  const conflicts = useMemo(
    () => (timesReady ? findOverlaps(start, end, reservations) : []),
    [timesReady, start, end, reservations],
  )

  const visible = useMemo(() => {
    const sorted = sortByStart(reservations)
    if (filter === 'all') return sorted
    return sorted.filter((item) =>
      filter === 'active' ? item.status === 'active' : item.status === 'cancelled',
    )
  }, [reservations, filter])

  const activeCount = reservations.filter((r) => r.status === 'active').length
  const cancelledCount = reservations.length - activeCount
  const todayCount = reservations.filter(
    (r) => r.status === 'active' && dateOf(r.start) === todayKey,
  ).length

  /** 保存済みを読み直して画面へ反映する。他のタブでの変更を踏み潰さないため */
  function syncFrom(latest: ReturnType<typeof loadReservations>) {
    setReservations(latest.items)
    setUnreadable(latest.unreadable)
    setLoadFailed(latest.failed)
    setDiscarded(latest.discarded)
  }

  function handleChange<K extends keyof ReservationInput>(
    key: K,
    value: ReservationInput[K],
  ) {
    setDraft((prev) => {
      const next = { ...prev, [key]: value }
      // 開始を入れた時点で終了が空なら1時間後を埋めておく。
      // 「終了が開始より前」の入力ミスは、終了を手で打つときに起きるため入口を減らす
      if (key === 'start' && prev.end === '' && typeof value === 'string') {
        next.end = shiftMinutes(normalizeDateTime(value), DEFAULT_MINUTES)
      }
      return next
    })
    // 直したそばから消す。押すまでエラーが残ると、直したのに怒られ続けているように見える
    setErrors((prev) => {
      if (prev[key] === undefined) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
    setFlash(null)
  }

  function handleSubmit() {
    const found = validateInput(draft)
    if (hasErrors(found)) {
      setErrors(found)
      setFlash(null)
      return
    }

    /*
      画面に出している一覧ではなく、保存済みを読み直してから判定する。
      別のタブで登録された予約は、この画面の state には入っていない。
      表示用の値を信用すると、重なりを見逃したうえに、
      書き戻しで相手のタブの予約を消してしまう。
    */
    const latest = loadReservations()
    const blocking = findOverlaps(start, end, latest.items)
    if (blocking.length > 0) {
      syncFrom(latest)
      setFlash({ kind: 'alert', text: 'この時間帯には別の予約があります' })
      return
    }

    const added: Reservation = {
      id: createId(),
      customerName: draft.customerName.trim(),
      serviceName: draft.serviceName.trim(),
      start,
      end,
      memo: draft.memo.trim(),
      status: 'active',
      createdAt: new Date().toISOString(),
    }

    setReservations([...latest.items, added])
    setUnreadable(latest.unreadable)
    setLoadFailed(latest.failed)
    setDiscarded(latest.discarded)
    setDraft(EMPTY)
    setErrors({})
    setRestoreBlock(null)
    setFlash({ kind: 'ok', text: '予約を登録しました' })
    // 登録したものがすぐ見えないと「入ったのか分からない」ので、一覧を予約中に戻す
    setFilter('active')
  }

  /**
   * 空き確認だけを行う。名前が未入力でも答えを出す。
   * 電話を受けながら「その時間、空いていますか」に即答するための操作で、
   * ここで氏名を求めると、聞く前に答えられなくなる。
   */
  function handleCheck() {
    const found = validateInput(draft)
    const timeErrors: FieldErrors = {}
    if (found.start !== undefined) timeErrors.start = found.start
    if (found.end !== undefined) timeErrors.end = found.end

    if (Object.keys(timeErrors).length > 0) {
      setErrors((prev) => ({ ...prev, ...timeErrors }))
      setFlash(null)
      return
    }

    // ここでも保存済みを見る。別のタブで入った予約を「空いています」と答えない
    const latest = loadReservations()
    syncFrom(latest)
    const hits = findOverlaps(start, end, latest.items)

    setFlash(
      hits.length > 0
        ? { kind: 'alert', text: 'この時間帯には別の予約があります' }
        : { kind: 'ok', text: 'この時間帯は空いています' },
    )
  }

  /**
   * キャンセルは確認を挟まない。取り消しても「予約に戻す」で元通りにできるうえ、
   * 確認を毎回出すと押すのが億劫になり、キャンセル済みにし忘れた枠が
   * 空いていないことになって、この道具の目的が壊れる。
   */
  function handleCancel(id: string) {
    const latest = loadReservations()
    setUnreadable(latest.unreadable)
    setReservations(
      latest.items.map((item) =>
        item.id === id ? { ...item, status: 'cancelled' } : item,
      ),
    )
  }

  /**
   * キャンセルを取り消して予約に戻す。ここでも必ず重なりを見る。
   * キャンセルした枠には別のお客様を入れられるので、
   * 戻した瞬間に二重予約が生まれうる。登録時と同じ判定を通す
   */
  function handleRestore(id: string) {
    const latest = loadReservations()
    const target = latest.items.find((item) => item.id === id)
    if (!target) {
      // 別のタブで消えている
      syncFrom(latest)
      return
    }

    const hits = findOverlaps(target.start, target.end, latest.items, id)
    if (hits.length > 0) {
      syncFrom(latest)
      setRestoreBlock({ name: target.customerName, hits })
      return
    }

    setRestoreBlock(null)
    setUnreadable(latest.unreadable)
    setReservations(
      latest.items.map((item) =>
        item.id === id ? { ...item, status: 'active' } : item,
      ),
    )
  }

  /** 削除は元に戻せないので、ここだけ確認する */
  function handleDelete(id: string) {
    const target = reservations.find((item) => item.id === id)
    if (!target) return
    const ok = window.confirm(
      `${target.customerName} さんの予約記録を完全に削除します。\n元に戻せません。よろしいですか？`,
    )
    if (!ok) return
    const latest = loadReservations()
    setRestoreBlock(null)
    setUnreadable(latest.unreadable)
    setReservations(latest.items.filter((item) => item.id !== id))
  }

  const emptyMessage =
    filter === 'cancelled'
      ? 'キャンセルした予約はありません'
      : '登録された予約はありません'

  const overlapping = conflicts.length > 0
  const dataProblem = loadFailed || discarded > 0 || unreadable.length > 0

  return (
    <div className="shell">
      <header className="masthead">
        <p className="wordmark">
          <LogoMark size={20} />
          予約チェック
        </p>
        <h1>予約が重なる前に確認できます</h1>
        <p className="lead">
          登録時にダブルブッキングを知らせる、個人事業主向けの予約確認ツール
        </p>

        {/*
          読み上げの繰り返しになるため、この数字は自動で読み上げない。
          時刻を1文字打つたびに件数まで読まれると、肝心の警告が埋もれる
        */}
        <div className="stats">
          <div className="stat">
            <p className="stat-label">今日の予約</p>
            <p className="stat-value">
              <span className="num">{todayCount}</span>
              <span className="stat-unit">件</span>
            </p>
          </div>

          <span className="stat-div" aria-hidden="true" />

          <div className={overlapping ? 'stat is-alert' : 'stat'}>
            <p className="stat-label">重なり</p>
            <p className="stat-value">
              {overlapping && <IconWarning size={24} />}
              <span className="num">{conflicts.length}</span>
              <span className="stat-unit">件</span>
            </p>
            <p className="stat-note">
              {overlapping ? '確認してください' : '重なりなし'}
            </p>
          </div>
        </div>
      </header>

      {/*
        赤い帯は画面に1本まで。2本並ぶとどちらも読み飛ばされる。
        予約が消えることは重なりより先に伝える。
        重なりの詳細（誰と何時が）はフォーム内の1箇所にまとめ、ここは結論だけ出す。
      */}
      {saveFailed ? (
        <p className="bar is-alert" role="alert">
          <IconWarning />
          このパソコンに保存できませんでした。画面を閉じると予約が消えます。受けた予約は別の場所にも控えてください。
        </p>
      ) : loadFailed ? (
        <p className="bar is-alert" role="alert">
          <IconWarning />
          保存されていた予約を読み取れませんでした。控えを取ってあります。この画面で何か登録すると読み取れなかった内容は上書きされます。
        </p>
      ) : overlapping ? (
        <p className="bar is-alert" role="alert">
          <IconWarning />
          この時間帯には別の予約があります
        </p>
      ) : (
        flash !== null && (
          <p
            className={flash.kind === 'ok' ? 'bar is-ok' : 'bar is-alert'}
            role="status"
          >
            {flash.kind === 'ok' ? <IconCheck /> : <IconWarning />}
            {flash.text}
          </p>
        )
      )}

      {/*
        日時が読めない予約。判定には使えないので、その時間帯は重なりを見つけられない。
        黙って消すと、その枠だけ二重予約を許すことになるため、必ず画面に出す
      */}
      {!loadFailed && dataProblem && (
        <div className="damaged" role="alert">
          <p className="damaged-head">
            <IconWarning />
            読み取れなかった予約があります
          </p>
          {unreadable.length > 0 && (
            <>
              <p className="damaged-note">
                次の{unreadable.length}件は日時を読み取れないため、重なりの確認ができません。
                内容を確かめて、登録し直してください。
              </p>
              <ul className="damaged-list">
                {unreadable.map((item) => (
                  <li key={item.id}>
                    <span className="damaged-name">{item.customerName}</span>
                    <span className="damaged-service">{item.serviceName}</span>
                    <span className="damaged-time">
                      {item.start} 〜 {item.end}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {discarded > 0 && (
            <p className="damaged-note">
              予約として読めない記録が{discarded}件ありました。控えを取ってあります。
            </p>
          )}
        </div>
      )}

      <div className="cols">
        <section className="col col-form">
          <h2 className="col-head">新しい予約</h2>
          <ReservationForm
            draft={draft}
            errors={errors}
            conflicts={conflicts}
            reservations={reservations}
            todayKey={todayKey}
            onChange={handleChange}
            onSubmit={handleSubmit}
            onCheck={handleCheck}
          />
        </section>

        <section className="col col-list">
          <h2 className="col-head">予約一覧</h2>

          <div className="tabs" role="group" aria-label="表示する予約をしぼる">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                className={filter === f.value ? 'tab is-on' : 'tab'}
                onClick={() => setFilter(f.value)}
                aria-pressed={filter === f.value}
              >
                {f.label}
                <span className="tab-count num">
                  {f.value === 'active'
                    ? activeCount
                    : f.value === 'cancelled'
                      ? cancelledCount
                      : reservations.length}
                </span>
              </button>
            ))}
          </div>

          {restoreBlock !== null && (
            <div className="restore">
              <p className="restore-head">
                <IconWarning />
                {restoreBlock.name} さんの予約は戻せません。キャンセルしたあとに、この枠へ別の予約が入っています。
              </p>
              <OverlapNotice hits={restoreBlock.hits} />
            </div>
          )}

          <ReservationList
            reservations={visible}
            emptyMessage={emptyMessage}
            nowMinutes={nowMinutes}
            todayKey={todayKey}
            onCancel={handleCancel}
            onRestore={handleRestore}
            onDelete={handleDelete}
          />
        </section>
      </div>

      <footer className="foot">
        <p>登録した内容はこのパソコンの中だけに保存されます。どこにも送信されません。</p>
        <p>端末を変えると引き継がれないので、大事な予約は他の台帳にも控えてください。</p>
      </footer>
    </div>
  )
}

export default App
