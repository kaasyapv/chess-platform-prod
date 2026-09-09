/* Hand-drawn flat SVG icons for the classroom's Gamified Board - replaces the
 * plain-text emoji glyphs everywhere they were placeable/rendered (picker
 * buttons in the Setup Position modal, and the sticker overlay on the live
 * board). Same flat-fill, no-black-outline treatment as the premium avatar
 * art, so the two features read as one visual system.
 *
 * `id` is what actually travels through the FEN pipeline (square -> id, see
 * customize-position.tsx / chess-board.tsx) - it used to be the emoji
 * character itself; now it's one of these stable string keys. */

export type GamifiedCategory = {
  id: string;
  label: string;
  icon: string; // the id of this category's own tab glyph
  items: { id: string; label: string }[];
};

export const GAMIFIED_CATEGORIES: GamifiedCategory[] = [
  { id: "food", label: "Food", icon: "burger", items: [
    { id: "burger", label: "Burger" }, { id: "apple", label: "Apple" }, { id: "donut", label: "Donut" },
  ] },
  { id: "toys", label: "Toys", icon: "teddy", items: [
    { id: "teddy", label: "Teddy Bear" }, { id: "robot", label: "Robot" }, { id: "yoyo", label: "Yo-yo" },
  ] },
  { id: "animals", label: "Animals", icon: "cat", items: [
    { id: "cat", label: "Cat" }, { id: "dog", label: "Dog" }, { id: "rabbit", label: "Rabbit" },
  ] },
  { id: "rewards", label: "Rewards", icon: "trophy", items: [
    { id: "trophy", label: "Trophy" }, { id: "star", label: "Star" }, { id: "medal", label: "Medal" },
  ] },
  { id: "emoji", label: "Emoji", icon: "smile", items: [
    { id: "smile", label: "Smile" }, { id: "heart", label: "Heart" }, { id: "thumbsup", label: "Thumbs Up" },
  ] },
];

export const BLOCKS_ITEMS: { id: string; label: string }[] = [
  { id: "barricade", label: "Barricade" },
  { id: "brick", label: "Brick Wall" },
  { id: "rock", label: "Rock" },
  { id: "fence", label: "Wooden Fence" },
];

/** The only gamified stickers that are "roadblock signs" - non-capturable,
 *  per the client spec. Every other sticker (food/toys/animals/rewards/
 *  emoji) is capturable/movable like a normal piece. */
export const NONCAPTURABLE_ICON_IDS = new Set(BLOCKS_ITEMS.map((b) => b.id));

/** Every icon is drawn in a 0 0 24 24 box, flat fills only. */
function Burger() {
  return <g>
    <path d="M3 9.5C3 6 7 4 12 4s9 2 9 5.5H3z" fill="#E8A94B" />
    <rect x="2.5" y="9.5" width="19" height="2.4" rx="1.2" fill="#7A9A3A" />
    <rect x="2.5" y="12.2" width="19" height="2.6" rx="1.3" fill="#8B4B2E" />
    <rect x="2.5" y="15.1" width="19" height="1.8" rx="0.9" fill="#F2C94C" />
    <path d="M2.5 17.2h19c0 2-2.5 3.3-9.5 3.3s-9.5-1.3-9.5-3.3z" fill="#D98A3D" />
  </g>;
}
function Apple() {
  return <g>
    <path d="M12 8.5c2.4-2.2 6-1 6 2.7 0 4-3 8.3-6 8.3s-6-4.3-6-8.3c0-3.7 3.6-4.9 6-2.7z" fill="#DA4B3E" />
    <path d="M12 8.5c.6-1.3.4-2.6-.6-3.6" stroke="#7A9A3A" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    <path d="M12.2 5.4c1.3-.5 2.4-.2 3 .6-1.1.7-2.2.6-3-.6z" fill="#7A9A3A" />
  </g>;
}
function Donut() {
  return <g>
    <circle cx="12" cy="12.5" r="8" fill="#C6813F" />
    <path d="M4.3 10.8a8 8 0 0115.4 0C17.7 8 15 6.3 12 6.3s-5.7 1.7-7.7 4.5z" fill="#F2A5C4" />
    <circle cx="12" cy="12.5" r="3" fill="#7A5230" />
    <circle cx="8.5" cy="9.5" r="0.8" fill="#fff" /><circle cx="12" cy="7.8" r="0.8" fill="#fff" />
    <circle cx="15.3" cy="9.3" r="0.8" fill="#fff" />
  </g>;
}
function Teddy() {
  return <g>
    <circle cx="6" cy="6.5" r="2.6" fill="#B5773F" /><circle cx="18" cy="6.5" r="2.6" fill="#B5773F" />
    <circle cx="6" cy="6.5" r="1.2" fill="#8A5A30" /><circle cx="18" cy="6.5" r="1.2" fill="#8A5A30" />
    <circle cx="12" cy="13" r="8" fill="#D9A05B" />
    <ellipse cx="12" cy="14.5" rx="3.6" ry="3" fill="#EFC38C" />
    <circle cx="8.7" cy="10.7" r="1.1" fill="#3A2A1E" /><circle cx="15.3" cy="10.7" r="1.1" fill="#3A2A1E" />
    <ellipse cx="12" cy="13.2" rx="1.1" ry="0.9" fill="#3A2A1E" />
  </g>;
}
function Robot() {
  return <g>
    <rect x="4" y="8" width="16" height="12" rx="3.5" fill="#93A3B5" />
    <circle cx="12" cy="4.2" r="1.4" fill="#93A3B5" /><rect x="11.2" y="5" width="1.6" height="3" fill="#93A3B5" />
    <rect x="7" y="12" width="4" height="4" rx="1.4" fill="#3ECBE0" />
    <rect x="13" y="12" width="4" height="4" rx="1.4" fill="#3ECBE0" />
    <rect x="8" y="17" width="8" height="1.6" rx="0.8" fill="#5A6B7D" />
  </g>;
}
function Yoyo() {
  return <g>
    <circle cx="12" cy="12" r="8" fill="#4A6FE0" />
    <circle cx="12" cy="12" r="3.4" fill="#8FA6EE" />
    <circle cx="12" cy="12" r="1.3" fill="#2E4AB0" />
    <path d="M12 20v2.4" stroke="#B8C2D9" strokeWidth="1.3" strokeLinecap="round" />
  </g>;
}
function Cat() {
  return <g>
    <path d="M5 4l2.5 6M19 4l-2.5 6" stroke="#E8934E" strokeWidth="3" strokeLinecap="round" />
    <circle cx="12" cy="13" r="8" fill="#E8934E" />
    <ellipse cx="9" cy="13" rx="1.1" ry="1.4" fill="#3A2A1E" /><ellipse cx="15" cy="13" rx="1.1" ry="1.4" fill="#3A2A1E" />
    <path d="M11 16.5h2l-1 1.2z" fill="#3A2A1E" />
  </g>;
}
function Dog() {
  return <g>
    <path d="M4 7c-2 3-2 8 1.5 9L8 10z" fill="#B5773F" /><path d="M20 7c2 3 2 8-1.5 9L16 10z" fill="#B5773F" />
    <circle cx="12" cy="13" r="8" fill="#D9A05B" />
    <circle cx="9" cy="12.5" r="1.1" fill="#3A2A1E" /><circle cx="15" cy="12.5" r="1.1" fill="#3A2A1E" />
    <ellipse cx="12" cy="16" rx="1.6" ry="1.2" fill="#3A2A1E" />
  </g>;
}
function Rabbit() {
  return <g>
    <ellipse cx="8.5" cy="5" rx="2.2" ry="6" fill="#D8D2C8" transform="rotate(-12 8.5 5)" />
    <ellipse cx="15.5" cy="5" rx="2.2" ry="6" fill="#D8D2C8" transform="rotate(12 15.5 5)" />
    <ellipse cx="8.5" cy="5.5" rx="1" ry="4" fill="#EFC9CE" transform="rotate(-12 8.5 5.5)" />
    <ellipse cx="15.5" cy="5.5" rx="1" ry="4" fill="#EFC9CE" transform="rotate(12 15.5 5.5)" />
    <circle cx="12" cy="14.5" r="7.5" fill="#EDE7DC" />
    <circle cx="9.3" cy="14" r="1" fill="#3A2A1E" /><circle cx="14.7" cy="14" r="1" fill="#3A2A1E" />
    <ellipse cx="12" cy="17" rx="1.3" ry="1" fill="#E8A6AC" />
  </g>;
}
function Trophy() {
  return <g>
    <path d="M7 4h10v6a5 5 0 01-10 0z" fill="#F0B429" />
    <path d="M7 5H3.5a3 3 0 003 4H7zM17 5h3.5a3 3 0 01-3 4H17z" fill="#D89A1E" />
    <rect x="10.5" y="14" width="3" height="4" fill="#D89A1E" />
    <rect x="8" y="18.5" width="8" height="2" rx="1" fill="#D89A1E" />
  </g>;
}
function Star() {
  return <path d="M12 3.5l2.4 5 5.5.7-4 3.9.9 5.5-4.8-2.6-4.8 2.6.9-5.5-4-3.9 5.5-.7z" fill="#F0B429" />;
}
function Medal() {
  return <g>
    <path d="M8 3l4 8 4-8h-3l-1 2-1-2z" fill="#D64545" />
    <circle cx="12" cy="15" r="6.5" fill="#F0B429" />
    <circle cx="12" cy="15" r="4" fill="#FBD97A" />
    <path d="M12 12.3l1 2 2.2.3-1.6 1.5.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.5 2.2-.3z" fill="#D89A1E" />
  </g>;
}
function Smile() {
  return <g>
    <circle cx="12" cy="12" r="8.5" fill="#F0B429" />
    <circle cx="8.7" cy="10.2" r="1.2" fill="#3A2A1E" /><circle cx="15.3" cy="10.2" r="1.2" fill="#3A2A1E" />
    <path d="M7.5 13.5c1.2 2.6 3 3.9 4.5 3.9s3.3-1.3 4.5-3.9z" fill="#3A2A1E" />
  </g>;
}
function Heart() {
  return <path d="M12 20s-7.5-4.9-7.5-10.6A4.4 4.4 0 0112 6.4a4.4 4.4 0 017.5 3c0 5.7-7.5 10.6-7.5 10.6z" fill="#E0455E" />;
}
function ThumbsUp() {
  return <g>
    <rect x="3" y="10" width="4" height="10" rx="1.5" fill="#4A6FE0" />
    <path d="M9 10l2.2-6.2a1.8 1.8 0 013.3 1.2L13.3 10H19a2 2 0 011.9 2.6l-1.8 6A2 2 0 0117.2 20H9z" fill="#F0B429" />
  </g>;
}
function Barricade() {
  return <g>
    <rect x="2" y="8" width="20" height="6" rx="1" fill="#E0455E" />
    {[0, 1, 2, 3].map((i) => (
      <path key={i} d={`M${3 + i * 5} 8l4 6h-2l-4-6z`} fill="#fff" />
    ))}
    <rect x="4" y="14" width="2" height="6" rx="0.6" fill="#8A5A30" />
    <rect x="18" y="14" width="2" height="6" rx="0.6" fill="#8A5A30" />
  </g>;
}
function Brick() {
  return <g>
    <rect x="2" y="4" width="20" height="16" rx="1.5" fill="#B5502F" />
    {[4, 9.5, 15].map((y, r) => (
      <g key={y}>
        {(r % 2 === 0 ? [2, 8, 14, 20] : [-1, 5, 11, 17, 23]).map((x) => (
          <rect key={x} x={x} y={y} width="5.4" height="4.5" rx="0.6" fill="#8F3A22" stroke="#B5502F" strokeWidth="0.6" />
        ))}
      </g>
    ))}
  </g>;
}
function Rock() {
  return <g>
    <path d="M4 16c-1-4 2-7 5-8 2-3 8-3 9 1 3 0 5 3 4 6-1 3-4 4-8 4H9c-3 0-4.5-1-5-3z" fill="#8B93A0" />
    <path d="M8 8c2-3 8-3 9 1-2-1-6-1-9-1z" fill="#A5AEBB" />
  </g>;
}
function Fence() {
  return <g>
    {[2.5, 8, 13.5, 19].map((x) => (
      <g key={x}>
        <rect x={x} y="4" width="3.5" height="16" rx="1" fill="#B5773F" />
        <path d={`M${x} 4l1.75-3 1.75 3z`} fill="#9A5F2E" />
      </g>
    ))}
    <rect x="1" y="9" width="22" height="2.2" rx="1" fill="#8A5A30" opacity="0.7" />
  </g>;
}

const ICONS: Record<string, () => React.JSX.Element> = {
  burger: Burger, apple: Apple, donut: Donut,
  teddy: Teddy, robot: Robot, yoyo: Yoyo,
  cat: Cat, dog: Dog, rabbit: Rabbit,
  trophy: Trophy, star: Star, medal: Medal,
  smile: Smile, heart: Heart, thumbsup: ThumbsUp,
  barricade: Barricade, brick: Brick, rock: Rock, fence: Fence,
};

/** Renders one gamified icon by id - picker buttons and the board overlay
 *  both go through this, so there is exactly one drawing per id. */
export function GamifiedIcon({ id, className }: { id: string; className?: string }) {
  const Icon = ICONS[id];
  if (!Icon) return null;
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" className={className} aria-hidden>
      <Icon />
    </svg>
  );
}
