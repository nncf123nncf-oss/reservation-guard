import { useId } from 'react'
import {
  MAX_MEMO_LENGTH,
  SERVICE_PRESETS,
  type Reservation,
} from '../types/reservation.ts'
import {
  crossesDate,
  dateOf,
  formatDuration,
  formatRange,
  normalizeDateTime,
  toMinutes,
  type FieldErrors,
  type OverlapHit,
  type ReservationInput,
} from '../utils/overlap.ts'
import { DayTimeline } from './DayTimeline.tsx'
import { OverlapNotice } from './OverlapNotice.tsx'
import { IconInputError, IconWarning } from './Icon.tsx'

interface Props {
  draft: ReservationInput
  errors: FieldErrors
  /** 判定は画面全体で1つ。ここでは受け取って見せるだけにする */
  conflicts: OverlapHit[]
  reservations: Reservation[]
  todayKey: string
  onChange: <K extends keyof ReservationInput>(
    key: K,
    value: ReservationInput[K],
  ) => void
  onSubmit: () => void
  onCheck: () => void
}

export function ReservationForm({
  draft,
  errors,
  conflicts,
  reservations,
  todayKey,
  onChange,
  onSubmit,
  onCheck,
}: Props) {
  const uid = useId()

  const start = normalizeDateTime(draft.start)
  const end = normalizeDateTime(draft.end)
  const startMin = toMinutes(start)
  const endMin = toMinutes(end)
  const timesReady = startMin !== null && endMin !== null && endMin > startMin
  const blocked = conflicts.length > 0

  // 開始が読めればその日、まだなら今日の並びを映す。最初から空の帯を出さない
  const anchorDate = startMin !== null ? dateOf(start) : todayKey

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // ボタンは押せる状態にしてある（キーボードから到達できるようにするため）。
    // 進ませないのはここで止める
    if (blocked) return
    onSubmit()
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <DayTimeline
        anchorDate={anchorDate}
        reservations={reservations}
        candidate={timesReady ? { start, end } : null}
        todayKey={todayKey}
      />

      {/* 帯の読み方。色の意味が分からないと図そのものが伝わらないので、読み上げからも隠さない */}
      <ul className="legend">
        <li>
          <i className="sw sw-booked" aria-hidden="true" />
          予約済み
        </li>
        <li>
          <i className="sw sw-cand" aria-hidden="true" />
          入力中
        </li>
        <li>
          <i className="sw sw-clash" aria-hidden="true" />
          重なり
        </li>
      </ul>

      <div className="field">
        <label htmlFor={`${uid}-name`}>お客様の名前</label>
        <input
          id={`${uid}-name`}
          type="text"
          value={draft.customerName}
          onChange={(e) => onChange('customerName', e.target.value)}
          placeholder="山田 花子"
          autoComplete="off"
          aria-invalid={errors.customerName !== undefined}
          aria-describedby={
            errors.customerName !== undefined ? `${uid}-name-err` : undefined
          }
        />
        {errors.customerName !== undefined && (
          <p className="err" id={`${uid}-name-err`}>
            <IconInputError size={16} />
            {errors.customerName}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor={`${uid}-service`}>メニュー</label>
        <input
          id={`${uid}-service`}
          type="text"
          value={draft.serviceName}
          onChange={(e) => onChange('serviceName', e.target.value)}
          placeholder="カット"
          list={`${uid}-services`}
          autoComplete="off"
          aria-invalid={errors.serviceName !== undefined}
          aria-describedby={
            errors.serviceName !== undefined ? `${uid}-service-err` : undefined
          }
        />
        {/* よく使うメニューは選ぶだけにする。スマホでの文字入力を1回でも減らす */}
        <datalist id={`${uid}-services`}>
          {SERVICE_PRESETS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {errors.serviceName !== undefined && (
          <p className="err" id={`${uid}-service-err`}>
            <IconInputError size={16} />
            {errors.serviceName}
          </p>
        )}
      </div>

      {/*
        開始と終了は縦に積む。横に2つ並べると
        「年/月/日 --:--」が潰れて、いま何を触っているのか分からなくなる
      */}
      <div className="field">
        <label htmlFor={`${uid}-start`}>開始日時</label>
        <input
          id={`${uid}-start`}
          type="datetime-local"
          className="num"
          value={draft.start}
          onChange={(e) => onChange('start', e.target.value)}
          aria-invalid={errors.start !== undefined}
          aria-describedby={errors.start !== undefined ? `${uid}-start-err` : undefined}
        />
        {errors.start !== undefined && (
          <p className="err" id={`${uid}-start-err`}>
            <IconInputError size={16} />
            {errors.start}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor={`${uid}-end`}>終了日時</label>
        <input
          id={`${uid}-end`}
          type="datetime-local"
          className="num"
          value={draft.end}
          onChange={(e) => onChange('end', e.target.value)}
          aria-invalid={errors.end !== undefined}
          aria-describedby={errors.end !== undefined ? `${uid}-end-err` : undefined}
        />
        {errors.end !== undefined && (
          <p className="err" id={`${uid}-end-err`}>
            <IconInputError size={16} />
            {errors.end}
          </p>
        )}
      </div>

      {/* 入れた時間帯を人の言葉で読み返す。年や日の打ち間違いはここで気づく */}
      {timesReady && (
        <p className="echo">
          <span className="echo-range num">{formatRange(start, end)}</span>
          <span className="echo-dur">{formatDuration(endMin - startMin)}</span>
          {crossesDate(start, end) && <span className="echo-flag">日をまたぎます</span>}
        </p>
      )}

      {/*
        重なりの詳細はこの1箇所だけに出す。原因は時刻なので、時刻欄の直下で止める。
        ここより下の入力（メモ）を打ち終えてから知らせても遅い
      */}
      {blocked && <OverlapNotice hits={conflicts} />}

      <div className="field">
        <label htmlFor={`${uid}-memo`}>
          メモ<span className="opt">任意</span>
        </label>
        <textarea
          id={`${uid}-memo`}
          value={draft.memo}
          onChange={(e) => onChange('memo', e.target.value)}
          rows={2}
          placeholder="電話予約／指名あり など"
          maxLength={MAX_MEMO_LENGTH}
          aria-invalid={errors.memo !== undefined}
        />
        {errors.memo !== undefined && (
          <p className="err">
            <IconInputError size={16} />
            {errors.memo}
          </p>
        )}
      </div>

      <div className="actions">
        {/*
          重なっているときは灰色に落とさない。灰色は「壊れている」に見えて理由が伝わらない。
          赤い枠と文言で「押せない理由」を持たせる。

          disabled ではなく aria-disabled にしてある。
          disabled にするとタブ移動の対象から外れ、キーボードと読み上げの利用者は
          ボタンに到達できない＝「この時間には登録できません」を読む機会が無くなる。
          押しても進まないことは onSubmit の先頭で止めている
        */}
        <button
          type="submit"
          className={blocked ? 'btn-main is-blocked' : 'btn-main'}
          aria-disabled={blocked}
        >
          {blocked && <IconWarning />}
          {blocked ? 'この時間には登録できません' : '予約を登録'}
        </button>

        {/*
          時刻を入れた時点で判定は済んでいるが、電話口で「空いていますか」に
          答えるときは、押して答えが返る形の方が確かめた実感が残る
        */}
        <button type="button" className="btn-sub" onClick={onCheck}>
          重複を確認
        </button>
      </div>
    </form>
  )
}
