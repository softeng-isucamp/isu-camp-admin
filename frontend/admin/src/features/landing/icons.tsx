import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Base({ size = 20, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  )
}

export const IconSearch = (p: IconProps) => <Base {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Base>
export const IconDownload = (p: IconProps) => <Base {...p}><path d="M12 4v11" /><path d="m7 10.5 5 5 5-5" /><path d="M5 20h14" /></Base>
export const IconArrowRight = (p: IconProps) => <Base {...p}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></Base>
export const IconArrowUpRight = (p: IconProps) => <Base {...p}><path d="M7 17 17 7" /><path d="M8 7h9v9" /></Base>
export const IconTurnRight = (p: IconProps) => <Base {...p}><path d="M6 20v-7a4 4 0 0 1 4-4h9" /><path d="m15 5 4 4-4 4" /></Base>
export const IconTurnLeft = (p: IconProps) => <Base {...p}><path d="M18 20v-7a4 4 0 0 0-4-4H5" /><path d="m9 5-4 4 4 4" /></Base>
export const IconPin =(p: IconProps) => <Base {...p}><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.4" /></Base>
export const IconDoor = (p: IconProps) => <Base {...p}><path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21" /><path d="M3.5 21h17" /><path d="M14.5 12.5v.01" /></Base>
export const IconCloudOff = (p: IconProps) => <Base {...p}><path d="M7.5 18.5h9.25a3.75 3.75 0 0 0 .6-7.45A5.5 5.5 0 0 0 6.6 9.6 4.5 4.5 0 0 0 7.5 18.5Z" /><path d="m12 10.5v5" /><path d="m9.75 13.5 2.25 2.25 2.25-2.25" /></Base>
export const IconCheck = (p: IconProps) => <Base {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Base>
export const IconBolt = (p: IconProps) => <Base {...p}><path d="M13 3 5.5 13.5H12L11 21l7.5-10.5H12L13 3Z" /></Base>
export const IconTree = (p: IconProps) => <Base {...p}><path d="M12 21v-5" /><path d="M7 16h10a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 6.6 8.3 4 4 0 0 0 7 16Z" /></Base>
export const IconLayers = (p: IconProps) => <Base {...p}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></Base>
export const IconWalk = (p: IconProps) => <Base {...p}><circle cx="13" cy="4.5" r="1.6" /><path d="m9.5 21 2.2-6.2 2.8 2.7V21" /><path d="M7.5 11.5 10 8.5l3.2-.8 2 3.4 2.8 1.2" /><path d="m11.7 14.8.8-6.6" /></Base>
export const IconPhone = (p: IconProps) => <Base {...p}><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M11 18.5h2" /></Base>
export const IconGlobe = (p: IconProps) => <Base {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></Base>
export const IconShare = (p: IconProps) => <Base {...p}><path d="M12 3v12" /><path d="m8 7 4-4 4 4" /><path d="M6 11H5v9.5h14V11h-1" /></Base>
export const IconMap = (p: IconProps) => <Base {...p}><path d="m3 6.5 6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5Z" /><path d="M9 4v13.5M15 6.5V20" /></Base>
export const IconNodes = (p: IconProps) => <Base {...p}><circle cx="5.5" cy="18.5" r="2" /><circle cx="18.5" cy="5.5" r="2" /><circle cx="17" cy="17" r="2" /><path d="M7 17 15.5 7M7.5 18.6l7.5-.9M18.2 7.5 17.4 15" /></Base>
export const IconList = (p: IconProps) => <Base {...p}><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></Base>
export const IconShield = (p: IconProps) => <Base {...p}><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m9 12 2 2 4-4" /></Base>
export const IconPlus = (p: IconProps) => <Base {...p}><path d="M12 5v14M5 12h14" /></Base>
export const IconSchool = (p: IconProps) => <Base {...p}><path d="m2.5 9 9.5-5 9.5 5-9.5 5-9.5-5Z" /><path d="M6.5 11.2V16c1.5 1.5 3.4 2.2 5.5 2.2s4-.7 5.5-2.2v-4.8" /></Base>
export const IconUsers = (p: IconProps) => <Base {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3 20c.6-3.4 3-5.4 6-5.4s5.4 2 6 5.4" /><path d="M16 4.9a3.2 3.2 0 0 1 0 6.2M18 14.8c1.6.7 2.7 2.4 3 5.2" /></Base>
export const IconCompass = (p: IconProps) => <Base {...p}><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></Base>
