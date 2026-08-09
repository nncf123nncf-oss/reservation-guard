/*
  状態を色だけで伝えないための小さな絵。外部の部品は使わず、ここで線を引いている。

  形で意味を分けてある。
    三角 … 相手がいる問題（別の予約と重なっている）
    丸   … 自分の入力の問題（終了が開始より前 など）
  同じ赤でも、形が違えば取り違えない。色が見えづらい人にも同じ情報が届く。
*/

interface Props {
  /** 表示サイズ（px）。文字の隣に置くので、行の高さに合わせて変える */
  size?: number
}

const base = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  // Internet Explorer 系の名残で、SVGは既定でタブ移動の対象になることがある。
  // 意味を持たない絵なので、キーボードの巡回からは外す
  focusable: false as const,
}

/** 予約を登録できた・コピーできた */
export function IconCheck({ size = 20 }: Props) {
  return (
    <svg {...base} width={size} height={size}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M6.5 10.5 L9 13 L13.5 7.5" />
    </svg>
  )
}

/** 別の予約と重なっている（相手がいる問題） */
export function IconWarning({ size = 20 }: Props) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M10 3.2 L17.2 16 H2.8 Z" />
      <path d="M10 8.4 V11.6" />
      <circle cx="10" cy="14.2" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** 入力そのものが正しくない（自分の入力の問題） */
export function IconInputError({ size = 20 }: Props) {
  return (
    <svg {...base} width={size} height={size}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6 V10.6" />
      <circle cx="10" cy="13.6" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** まだ1件も無い */
export function IconEmptyCalendar({ size = 20 }: Props) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={1.5}>
      <rect x="2.5" y="4.5" width="15" height="13" rx="1.5" />
      <path d="M6.5 2.5 V6" />
      <path d="M13.5 2.5 V6" />
      <path d="M2.5 8.5 H17.5" />
      <path d="M7.5 12.5 H12.5" />
    </svg>
  )
}

/** 予約の内容を書き写す */
export function IconCopy({ size = 20 }: Props) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={1.5}>
      <rect x="7" y="7" width="10.5" height="10.5" rx="1.5" />
      <path d="M13 4.5 H4.5 A1.5 1.5 0 0 0 3 6 V14" />
    </svg>
  )
}

/**
 * 名前の左に置く印。ずれて重なった2本の予定を表している。
 * 交差した所だけ赤くして、この道具が何を見張っているのかを一目で示す。
 */
export function LogoMark({ size = 20 }: Props) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      strokeWidth={2.5}
      strokeLinecap="round"
      aria-hidden="true"
      focusable={false}
    >
      <path d="M3 6.5 H12" stroke="var(--primary)" />
      <path d="M8 13.5 H17" stroke="var(--primary)" />
      <path d="M8 10 V10" stroke="var(--alert)" />
      <path d="M8.5 6.5 H12" stroke="var(--alert)" />
    </svg>
  )
}
