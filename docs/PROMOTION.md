# Promotion playbook

Tally's promotion should preserve its main advantage: people can open the app and start splitting immediately. Do not add a marketing gate, forced referral step, or promotional interruption to shared activity links.

## Positioning

Use these claims consistently:

- Free group expense splitting with no account required.
- Equal splits for everyone or only selected people, plus exact amounts.
- Local-first by default, with optional live collaboration for trusted groups.
- Clear person-to-person settlement suggestions.
- English and Simplified Chinese support.

Avoid claiming that Tally is a bank, payment processor, encrypted vault, or full Splitwise replacement. Tally records and calculates expenses; it does not transfer money.

## Fifteen-second demo

Record the production app at a mobile viewport with realistic but fictional data:

1. **0–3 seconds:** Create `Weekend trip` and add `Maya, Jordan`.
2. **3–7 seconds:** Add `Dinner · $90`, paid by the creator and split among all three people.
3. **7–10 seconds:** Show the person-to-person settlement suggestion.
4. **10–13 seconds:** Open the QR share screen and show that friends can join without creating accounts.
5. **13–15 seconds:** End on the activity dashboard with the caption `Free · No signup · Local-first`.

Never record real names, real expense data, live edit tokens, or a scannable production capability QR code. Use a disposable local activity or obscure the QR destination.

## Chinese social copy

### 小红书 title

`分账真的不用这么麻烦`

### Short caption

旅行、聚餐每次算账都很头疼，所以我做了一个不用注册的分账小工具 Tally。谁付的钱、哪些人参与分摊、最后谁该转给谁，都可以直接算清楚。平时数据保存在自己的浏览器里，需要一起改的时候再开实时共享。

### 朋友圈

最近做了个轻量分账工具 Tally：不用注册，打开就能记账和算 AA，也支持多人实时修改。旅行、聚餐或者合租都能用。欢迎试试，也欢迎来 GitHub 提建议 🙌

## English community post

> I built Tally, a free group-expense splitter that works without accounts. Local activities stay in your browser, while trusted groups can optionally collaborate through a private live link. It supports selective equal splits, exact amounts, settlements, QR sharing, and English/Simplified Chinese. Feedback and contributions are welcome.

Use the live app and repository links in plain text rather than URL shorteners so people can verify the destination.

## Channels

- 小红书 and WeChat Moments: lead with a real trip or dinner scenario.
- V2EX and 即刻: lead with the implementation decisions and local-first privacy model.
- Reddit `r/SideProject`: lead with the no-account workflow and ask for specific UX feedback.
- GitHub: keep screenshots, the live demo, architecture, testing standards, and contribution instructions current.

## Measurement

Compare `app_opened`, `activity_created`, and sharing events before and after each post. Use coarse campaign dates rather than adding personal identifiers or shared-link data to analytics.
