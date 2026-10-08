# Chog Mischief UI handoff: read before touching the frontend

The UI was designed and approved outside this repo. Your job is to PORT it into Next.js exactly, not to redesign it.

## Source of truth
- `design/prototype/index.html` is the approved, clickable design. Open it in a browser (serve the folder: `npx serve design/prototype`). Every screen, colour, outline, shadow, animation and piece of copy in it is final.
- `design/prototype/hark.css` supplies the base variables it uses (--tap, --type-body, --type-small, --type-tag, --dur-quick, --ease-out, --sans). Copy the values you need into `app/globals.css`.
- The `x-` classes in its `<style>` block ARE the design system.

## Hard rules
1. Do NOT restyle, "improve", swap fonts, change colours, rename copy, or replace the comic-sticker look with a generic shadcn/Tailwind look.
2. Port the prototype's `<style>` block into `app/globals.css` as-is (keep the `x-` class names). Use Tailwind only for layout glue. Do not convert the design to Tailwind utilities.
3. Fonts: Lilita One (display) + Geist/Inter (body) via `next/font/google`.
4. Tokens (do not change): purple #836EF9, magenta #FF4FD8, prank yellow #FFD23F, slime green #7CFF6B, background #140B2E, card #25174F, ink #06020F, text #F4EFFF, muted #C3B6F2. 3px ink outlines, 4px hard offset shadows.
5. One React component per prototype screen/component:
   - `components/TopBar.tsx`, `components/TabBar.tsx`, `components/ChogCard.tsx`, `components/PrankOverlay.tsx`, `components/Countdown.tsx`, `components/ChaosFeed.tsx`, `components/ShareCardModal.tsx`, `components/Toast.tsx`
   - routes: `/` (Landing), `/pick`, `/hq`, `/prank`, `/inbox`, `/ranks`, `/chog/[tokenId]`
6. Replace mock data with real data (wallet, Monad RPC traits/images, Supabase) ONLY. Keep the markup and classes.
7. Keep the 480px phone frame, 44px minimum tap targets, and prefers-reduced-motion support.
8. Visual check before any commit that touches UI: run Playwright at 390x844, screenshot every route, and compare it side by side with the same screen in the prototype. Log any difference in AGENTS.md and fix it before moving on.
9. If a real-data state has no design (e.g. loading, error, wallet with 0 Chogs), build it from existing `x-` components in the same style, and list it in AGENTS.md under "UI states to review" so David can send it to Hark.

## Do not
- Do not add a UI kit (shadcn, MUI, Chakra), a different icon set, or dark/light themes.
- Do not commit AGENTS.md.
