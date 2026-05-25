# MicroPost

Compact, tweet-length, rapid-fire.

## Overview

MicroPost is a dense, social-first design system for microblogging and short-form content platforms. It prioritizes content density — many posts visible per screen — while keeping each unit scannable and distinct. Rounded shapes and soft blue accents evoke the familiarity of social platforms, while compact spacing ensures the feed feels alive and full. Every component is optimized for quick reading, fast interaction, and clear threading between connected posts.

## Colors

- **Primary** (#3B82F6): Blue — links, active states, primary actions
- **Secondary** (#6B7280): Gray — metadata, secondary UI, timestamps
- **Tertiary** (#F3F4F6): Light — backgrounds, cards, thread connectors
- **Background** (#F9FAFB): Light gray page background
- **Surface** (#FFFFFF): Post cards, panels
- **Success** (#10B981)
- **Warning** (#F59E0B)
- **Error** (#EF4444)
- **Info** (#3B82F6)

## Typography

- **Headline Font**: Space Grotesk
- **Body Font**: DM Sans
- **Mono Font**: Roboto Mono

- **Display**: Space Grotesk 30px bold, 1.2 line height, 0.02em tracking. Trending topic headers.
- **Headline**: Space Grotesk 22px bold, 1.25 line height, 0.01em tracking. Profile names, page titles.
- **Subhead**: Space Grotesk 17px semibold, 1.35 line height. Section labels, thread starters.
- **Body Large**: DM Sans 16px regular, 1.55 line height. Featured posts, pinned content.
- **Body**: DM Sans 14px regular, 1.5 line height. Default post text.
- **Body Small**: DM Sans 13px regular, 1.45 line height. Reply text, nested content.
- **Caption**: DM Sans 11px medium, 1.4 line height, 0.01em tracking. Timestamps, character counts.
- **Overline**: DM Sans 10px bold, 1.3 line height, 0.08em tracking. Trending labels, badges.
- **Code**: Roboto Mono 13px regular, 1.5 line height. Inline code, code snippets.

## Spacing

- **Base unit**: 4px
- **Scale**: 2, 4, 8, 12, 16, 20, 24, 32, 48
- **Component padding — small**: 4px
- **Component padding — medium**: 8px
- **Component padding — large**: 16px
- **Section spacing — mobile**: 24px
- **Section spacing — tablet**: 32px
- **Section spacing — desktop**: 48px

## Border Radius

- **None** (0px): Dividers, thread lines
- **Small** (6px): Chips, small buttons
- **Medium** (12px): Cards, inputs, buttons, panels
- **Large** (16px): Modals, image previews
- **XL** (20px): Large containers, featured cards
- **Full** (9999px): Avatars, user badges, pill buttons
The default radius is 12px — rounded and social-friendly. User badges and action pills use full rounding.

## Elevation

**Philosophy:** Subtle elevation separates posts from the feed background. Shadows are light and diffused, never heavy.
- **Subtle**: 1px offset, 2px blur, #000000 at 4%. Post cards at rest.
- **Medium**: 2px offset, 8px blur, #000000 at 6%; 1px offset, 2px blur, #000000 at 4%. Hovered posts, active cards.
- **Large**: 8px offset, 24px blur, #000000 at 8%; 2px offset, 8px blur, #000000 at 4%. Composer, modals.
- **Overlay**: 16px offset, 48px blur, #000000 at 12%; 4px offset, 12px blur, #000000 at 6%. Dropdown menus, popovers.
**Special — Blue Focus:** 2px ring #F9FAFB, 4px ring #3B82F6 — accessible focus indicator.

## Components

### Buttons
- **Primary**: #3B82F6 fill, #FFFFFF text, no border, pill shape. DM Sans 13px semibold. 6px/16px padding. Hover: Background #2563EB. Active: Background #1D4ED8.
- **Secondary**: #F3F4F6 fill, #111827 text, no border, pill shape. DM Sans 13px semibold. 6px/16px padding. Hover: Background #E5E7EB. Active: Background #D1D5DB.
- **Ghost**: transparent, #6B7280 text, no border, pill shape. DM Sans 13px semibold. 6px/16px padding. Hover: Background #F3F4F6, text #111827. Active: Background #E5E7EB.
- **Destructive**: #EF4444 fill, #FFFFFF text, no border, pill shape. DM Sans 13px semibold. 6px/16px padding. Hover: Background #DC2626. Active: Background #B91C1C.
- **Sizes**: Small 4px 12px / 11px, Medium 6px 16px / 13px, Large 8px 24px / 14px
- **Disabled**: 40% opacity, disabled cursor, no hover effect.

### Cards
- **Default**: #FFFFFF fill, 1px #E5E7EB border, 12px corners, 1px offset, 2px blur, #000000 at 4% shadow. 12px/16px padding. Hover: Shadow 0 2px 8px #000000 at 6%; 1px offset, 2px blur, #000000 at 4%.
- **Elevated**: #FFFFFF fill, 1px #E5E7EB border, 12px corners, 2px offset, 8px blur, #000000 at 6%; 1px offset, 2px blur, #000000 at 4% shadow. 16px padding.

### Inputs
- **Text Input**: #FFFFFF fill, 1px #E5E7EB border, 12px corners, #111827 text. DM Sans 14px regular. 36px tall, 6px/12px padding, #9CA3AF placeholder color. Focus: Border #3B82F6, ring 2px ring #F9FAFB, 4px ring #3B82F6. Error: Border #EF4444. Disabled: Background #F9FAFB, 50% opacity.
- **Label**: DM Sans, 12px, weight 600, color #374151, bottom margin 4px.
- **Helper Text**: DM Sans, 11px, weight 400, color #9CA3AF, top margin 4px. Error helper color #EF4444.

### Chips
- **Filter Chip**: #F3F4F6 fill, no border, pill shape, #6B7280 text. DM Sans 12px semibold. 4px/12px padding. Selected: Background #3B82F6, text #FFFFFF. Hover: Background #E5E7EB.
- **Status Chip**: pill shape. DM Sans 10px bold uppercase. 2px/8px padding, Background #ECFDF5, text #10B981 success, Background #FFFBEB, text #F59E0B warning. Error: Background #FEF2F2, text #EF4444.

### Lists
- **Default List Item**: 1px #F3F4F6 border bottom, #111827 text. DM Sans 14px regular. 8px/12px padding, #9CA3AF, 11px secondary text, 32px avatar (rounded full) or 16px icon, color #6B7280 leading element. Hover: Background #F9FAFB. Active: Background #F3F4F6.

### Checkboxes
16px, 1.5px #D1D5DB border, 4px corners, #FFFFFF fill. Checked: Background #3B82F6, border #3B82F6, checkmark #FFFFFF. Indeterminate: Background #3B82F6, dash #FFFFFF. Hover: Border #3B82F6. Focus: Ring 2px ring #F9FAFB, 4px ring #3B82F6. Disabled: 40% opacity. Labels in DM Sans 13px regular left margin 8px.

### Radio Buttons
16px, 1.5px #D1D5DB border, pill shape, #FFFFFF fill. Selected: Border #3B82F6, inner dot #3B82F6 (6px). Hover: Border #3B82F6. Focus: Ring 2px ring #F9FAFB, 4px ring #3B82F6. Disabled: 40% opacity. Labels in DM Sans 13px regular left margin 8px.

### Tooltips
#111827 fill, #FFFFFF text, 8px corners, 4px offset, 12px blur, #000000 at 12% shadow. DM Sans 11px medium. 4px/10px padding, 200px max width, 5px, same background arrow, 400ms enter, 100ms leave delay.

## Do's and Don'ts

1. **Do** keep post cards compact — 12px 16px padding maximum, no excess whitespace within posts.
2. **Do** use pill-shaped buttons (9999px radius) for all primary actions like Post, Reply, Follow.
3. **Don't** display more than 280 characters without truncation — offer "Show more" expansion.
4. **Do** use thread connector lines (2px wide, #E5E7EB) to visually link parent and child posts.
5. **Don't** use heavy shadows or borders — the feed should feel light, seamless, and scrollable.
6. **Do** show timestamps in relative format ("2m", "1h", "3d") to reinforce the rapid-fire pace.
7. **Don't** let avatars exceed 40px in the feed — space is at a premium.
8. **Do** provide clear engagement affordances (reply, repost, like) with icon + count at 11px caption size.
9. **Don't** use red for anything other than errors, destructive actions, or notification badges.
10. **Do** ensure all interactive targets are at minimum 32px touch size despite the compact layout.
