import React from 'react'

interface KrsLogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string
}

export default function KrsLogo({ size = '100%', ...props }: KrsLogoProps) {
  // Generate the central gear path dynamically with 10 teeth
  const teeth = 10
  const cx = 250
  const cy = 250
  const rInner = 92
  const rOuter = 122
  const points: string[] = []
  const angleStep = (2 * Math.PI) / teeth

  for (let i = 0; i < teeth; i++) {
    const angle = i * angleStep - Math.PI / 2
    const angle1 = angle - angleStep * 0.22
    const angle2 = angle - angleStep * 0.12
    const angle3 = angle + angleStep * 0.12
    const angle4 = angle + angleStep * 0.22

    const x1 = cx + rInner * Math.cos(angle1)
    const y1 = cy + rInner * Math.sin(angle1)
    const x2 = cx + rOuter * Math.cos(angle2)
    const y2 = cy + rOuter * Math.sin(angle2)
    const x3 = cx + rOuter * Math.cos(angle3)
    const y3 = cy + rOuter * Math.sin(angle3)
    const x4 = cx + rInner * Math.cos(angle4)
    const y4 = cy + rInner * Math.sin(angle4)

    if (i === 0) {
      points.push(`M ${x1} ${y1}`)
    } else {
      points.push(`L ${x1} ${y1}`)
    }
    points.push(`L ${x2} ${y2}`)
    points.push(`L ${x3} ${y3}`)
    points.push(`L ${x4} ${y4}`)
  }
  points.push('Z')
  const gearPath = points.join(' ')

  // Precise vector path configurations for letters "K", "R", and "S"
  const pathK = `
    M 110 185
    H 150
    V 195
    H 140
    V 240
    L 185 195
    H 175
    V 185
    H 205
    V 195
    H 195
    L 155 250
    L 198 310
    H 210
    V 320
    H 175
    V 310
    H 185
    L 145 258
    V 310
    H 155
    V 320
    H 110
    V 310
    H 120
    V 195
    H 110
    Z
  `

  const pathR = `
    M 215 185
    H 275
    C 305 185, 305 250, 265 250
    L 290 310
    H 300
    V 320
    H 265
    V 310
    H 275
    L 252 250
    H 245
    V 310
    H 255
    V 320
    H 215
    V 310
    H 225
    V 195
    H 215
    Z
    M 245 200
    V 235
    H 265
    C 280 235, 280 200, 265 200
    Z
  `

  const pathSpineS = 'M 374 202 C 374 183, 318 183, 318 218 C 318 247, 378 253, 378 282 C 378 317, 322 317, 322 298'

  const pathDollarBar = `
    M 336 165
    H 360
    V 171
    H 352
    V 323
    H 360
    V 329
    H 336
    V 323
    H 344
    V 171
    H 336
    Z
  `

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 500 500"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <defs>
        {/* Shiny gold gradients for realistic metallic shading */}
        <linearGradient id="logo-gold-metallic" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFF4B8" />
          <stop offset="18%" stopColor="#DFB645" />
          <stop offset="35%" stopColor="#8E6B23" />
          <stop offset="50%" stopColor="#FFFCE5" />
          <stop offset="65%" stopColor="#CFA43B" />
          <stop offset="80%" stopColor="#A8822C" />
          <stop offset="92%" stopColor="#FFECA0" />
          <stop offset="100%" stopColor="#7E5C16" />
        </linearGradient>

        <linearGradient id="logo-gold-light" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#CFA43B" />
          <stop offset="45%" stopColor="#FFF7C2" />
          <stop offset="55%" stopColor="#FFEAA3" />
          <stop offset="100%" stopColor="#9C7728" />
        </linearGradient>



        {/* Dark radial gradient for the background */}
        <radialGradient id="logo-dark-radial" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1E1E24" />
          <stop offset="70%" stopColor="#0B0B0D" />
          <stop offset="100%" stopColor="#040405" />
        </radialGradient>

        {/* Glow and Drop Shadow filters */}
        <filter id="logo-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>

        <filter id="logo-shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.9" />
        </filter>

        {/* Concentric text guides */}
        {/* Top Text Guide: Clockwise arch */}
        <path id="guide-text-top" d="M 68 250 A 182 182 0 0 1 432 250" fill="none" />
        {/* Bottom Text Guide: Counter-Clockwise arch (keeps text upright and readable left-to-right) */}
        <path id="guide-text-bottom" d="M 68 250 A 182 182 0 0 0 432 250" fill="none" />
      </defs>

      {/* Main emblem structure */}
      <g filter="url(#logo-shadow)">
        {/* Outer thick gold ring */}
        <circle cx="250" cy="250" r="236" stroke="url(#logo-gold-metallic)" strokeWidth="6.5" />
        <circle cx="250" cy="250" r="227" stroke="url(#logo-gold-metallic)" strokeWidth="1.2" opacity="0.6" />

        {/* Techy Outer Ring Panel Cuts */}
        <path d="M 52 205 A 228 228 0 0 1 205 52" stroke="url(#logo-gold-metallic)" strokeWidth="3" strokeDasharray="25 10 60 10 120 15 30 10" strokeLinecap="round" />
        <path d="M 448 295 A 228 228 0 0 1 295 448" stroke="url(#logo-gold-metallic)" strokeWidth="3" strokeDasharray="25 10 60 10 120 15 30 10" strokeLinecap="round" />
        
        {/* Small sub-ticks along border */}
        <circle cx="250" cy="250" r="242" stroke="url(#logo-gold-metallic)" strokeWidth="1" strokeDasharray="2 16" opacity="0.4" />

        {/* Deep dark circular background */}
        <circle cx="250" cy="250" r="221" fill="url(#logo-dark-radial)" />

        {/* Concentric gold boundaries */}
        <circle cx="250" cy="250" r="216" stroke="url(#logo-gold-metallic)" strokeWidth="2.5" />
        <circle cx="250" cy="250" r="172" stroke="url(#logo-gold-metallic)" strokeWidth="2.5" />

        {/* Top Text: "KIIT ROBOTICS SOCIETY" */}
        <g fill="url(#logo-gold-light)" style={{ fontFamily: '"Montserrat", "Outfit", "Inter", sans-serif', fontWeight: 800, fontSize: '20px', letterSpacing: '4.8px' }}>
          <text>
            <textPath href="#guide-text-top" startOffset="50%" textAnchor="middle">
              KIIT ROBOTICS SOCIETY
            </textPath>
          </text>
        </g>

        {/* Bottom Text: "JOIN THE ROBOLUTION" */}
        <g fill="url(#logo-gold-light)" style={{ fontFamily: '"Montserrat", "Outfit", "Inter", sans-serif', fontWeight: 800, fontSize: '18px', letterSpacing: '5px' }}>
          <text dy="14">
            <textPath href="#guide-text-bottom" startOffset="50%" textAnchor="middle">
              JOIN THE ROBOLUTION
            </textPath>
          </text>
        </g>

        {/* Central Core Background */}
        <circle cx="250" cy="250" r="168" fill="#070709" />
        <circle cx="250" cy="250" r="168" stroke="url(#logo-gold-metallic)" strokeWidth="1.2" opacity="0.3" />

        {/* Circuit Traces (Backdrop) */}
        <g stroke="url(#logo-gold-metallic)" strokeWidth="1.5" fill="none" opacity="0.75" strokeLinecap="round">
          {/* Top side circuit routes */}
          <path d="M 205,160 V 125 L 185,105 V 80" />
          <path d="M 235,160 V 95" />
          <path d="M 265,160 V 95" />
          <path d="M 295,160 V 125 L 315,105 V 80" />

          {/* Bottom side circuit routes */}
          <path d="M 205,340 V 375 L 185,395 V 420" />
          <path d="M 235,340 V 405" />
          <path d="M 265,340 V 405" />
          <path d="M 295,340 V 375 L 315,395 V 420" />
        </g>

        {/* Circuit Nodes (Dots) */}
        <g fill="url(#logo-gold-metallic)">
          <circle cx="185" cy="80" r="3.5" />
          <circle cx="235" cy="95" r="3" />
          <circle cx="265" cy="95" r="3" />
          <circle cx="315" cy="80" r="3.5" />
          <circle cx="185" cy="420" r="3.5" />
          <circle cx="235" cy="405" r="3" />
          <circle cx="265" cy="405" r="3" />
          <circle cx="315" cy="420" r="3.5" />
        </g>

        {/* Central Gold Gear */}
        <path d={gearPath} fill="url(#logo-gold-metallic)" opacity="0.82" />
        <circle cx="250" cy="250" r="85" fill="#070709" />
        <circle cx="250" cy="250" r="85" stroke="url(#logo-gold-metallic)" strokeWidth="2.5" />
        <circle cx="250" cy="250" r="76" stroke="url(#logo-gold-metallic)" strokeWidth="1" strokeDasharray="3 4" opacity="0.45" />

        {/* Inner circuit ring inside the gear */}
        <circle cx="250" cy="250" r="45" stroke="url(#logo-gold-metallic)" strokeWidth="1.2" strokeDasharray="15 35 25 15" opacity="0.5" />

        {/* 3D Metal Embossed KRS Lettering */}
        <g filter="url(#logo-glow)">
          {/* Black shadow outline layer for depth */}
          <path d={pathK} fill="#000" stroke="#000" strokeWidth="6" strokeLinejoin="round" />
          <path d={pathR} fill="#000" stroke="#000" strokeWidth="6" strokeLinejoin="round" fillRule="evenodd" />
          <path d={pathSpineS} fill="none" stroke="#000" strokeWidth="32" strokeLinecap="butt" strokeLinejoin="round" />
          <path d={pathDollarBar} fill="#000" stroke="#000" strokeWidth="6" strokeLinejoin="round" />

          {/* Thick gold outer stroke */}
          <path d={pathK} stroke="url(#logo-gold-metallic)" strokeWidth="4.5" strokeLinejoin="round" fill="none" />
          <path d={pathR} stroke="url(#logo-gold-metallic)" strokeWidth="4.5" strokeLinejoin="round" fill="none" fillRule="evenodd" />
          <path d={pathSpineS} fill="none" stroke="url(#logo-gold-metallic)" strokeWidth="28" strokeLinecap="butt" strokeLinejoin="round" />
          <path d={pathDollarBar} stroke="url(#logo-gold-metallic)" strokeWidth="4.5" strokeLinejoin="round" fill="none" />

          {/* Dark inner shadow line to create visual separation of the face plate */}
          <path d={pathK} stroke="#070709" strokeWidth="2" strokeLinejoin="round" fill="none" />
          <path d={pathR} stroke="#070709" strokeWidth="2" strokeLinejoin="round" fill="none" fillRule="evenodd" />
          <path d={pathSpineS} fill="none" stroke="#070709" strokeWidth="22" strokeLinecap="butt" strokeLinejoin="round" />
          <path d={pathDollarBar} stroke="#070709" strokeWidth="2" strokeLinejoin="round" fill="none" />

          {/* Shiny gold surface plate fill */}
          <path d={pathK} fill="url(#logo-gold-light)" />
          <path d={pathR} fill="url(#logo-gold-light)" fillRule="evenodd" />
          <path d={pathSpineS} fill="none" stroke="url(#logo-gold-light)" strokeWidth="16" strokeLinecap="butt" strokeLinejoin="round" />
          <path d={pathDollarBar} fill="url(#logo-gold-light)" />
        </g>
      </g>
    </svg>
  )
}
