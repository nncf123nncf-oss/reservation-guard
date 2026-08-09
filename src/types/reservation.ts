/** 予約の状態。キャンセルは行そのものを消さずに状態で持つ（後述） */
export type ReservationStatus = 'active' | 'cancelled'

export interface Reservation {
  id: string
  customerName: string
  serviceName: string
  /**
   * 開始日時。`YYYY-MM-DDTHH:mm` の壁掛け時計そのまま（<input type="datetime-local"> の値）。
   * タイムゾーン付きのISO文字列にはしない。サロンの台帳は「10時の予約」であって
   * 「UTC 01:00 の予約」ではないため、変換を挟むほど時差・夏時間でズレる余地が増える。
   */
  start: string
  /** 終了日時。形式は start と同じ */
  end: string
  memo: string
  status: ReservationStatus
  /** 登録した順。同じ時間帯の並びを安定させるためだけに使う */
  createdAt: string
}

/**
 * 入力の上限。保存先の localStorage には容量の上限があり、
 * 際限なく貼り付けられると保存そのものが失敗する。入口で止める。
 */
export const MAX_NAME_LENGTH = 60
export const MAX_SERVICE_LENGTH = 60
export const MAX_MEMO_LENGTH = 500

/**
 * 1件の予約として認める最大の長さ（分）。7日。
 * 目的は「年を打ち間違えた予約」を弾くこと。2026を2062と打つと
 * 36年ぶんの予約が1件でき、以後すべての新規予約が重複扱いになって
 * この道具が全く使えなくなる。日をまたぐ予約は通したいので、
 * 深夜営業でも届かない7日を境界にする。
 */
export const MAX_DURATION_MINUTES = 7 * 24 * 60

export const SERVICE_PRESETS = [
  'カット',
  'カラー',
  'パーマ',
  'トリートメント',
  '体験レッスン',
  'グループレッスン',
  '個人レッスン',
  'カウンセリング',
] as const
