# Translation review

French (`fr`, used for Canada/Quebec) and Arabic (`ar`, UAE) strings in `client/src/locales/` were drafted by the build and have **not** been reviewed by a native speaker. Region packs for Canada and the UAE must not be activated for real customers until a reviewer has signed off the files below.

| File | Language | Reviewer | Date | Status |
|------|----------|----------|------|--------|
| `client/src/locales/fr.json` | Français (Canada) | — | — | needs review |
| `client/src/locales/ar.json` | العربية (UAE) | — | — | needs review |

Coverage today: sign-in, shared buttons and the HR onboarding checklist screens (`onboarding.*` keys, machine-drafted, needs review). There is no Urdu (`ur`) locale file yet, so Urdu users see English on these screens. More screens move to `t('key', 'English default')` phase by phase; any missing key falls back to English, so a partial translation never breaks a screen.

## Arabic PDF text

`server/src/services/rtlPdf.js` draws Arabic-script text right to left in PDFs using Noto Naskh Arabic (SIL Open Font License, `server/assets/fonts/`). It is **not yet used** by the receipt, voucher or statement PDFs: a sample (`arabic-pdf-sample.pdf`) must first be checked by a native reader for joined letters, reading direction and mixed Arabic/English/number lines.

## Property visits (visits.*)

French and Arabic strings for property visits (`visits.*`, `common.close`, `common.saved`) were machine-drafted and need a
native review, in particular the location notice (`visits.notice`). Urdu has no UI locale yet, so Urdu users see English.
