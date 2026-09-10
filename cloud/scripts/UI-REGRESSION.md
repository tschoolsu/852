# Mutation UI regression checks

The fixture is a separate, loopback-only development server. Its API uses disposable
in-memory records; it never forwards API calls or credentials to the real application.
Restart it or visit `/__fixture?reset` to recover every test record. It is not part of
the Worker build or the published application.

1. Run `npm run build`, then `npm run start -- --port 3210`.
2. In another terminal run `node scripts/ui-fixture.mjs` and open
   `http://127.0.0.1:3211`.
3. `/__fixture?delay=5000` simulates a five-second response time;
   `/__fixture?fail` fails the next API response. `/__fixture` shows recorded
   requests and current fake records for checking duplicate submissions.

Verified manually in the browser on 2026-09-11:

- Before the fix: a successful permanent deletion left the confirmation open after
  the detail dialog disappeared. The fake API showed the record was already gone.
- Upload with a blank name defaults to the selected file name. Double-clicking
  Create sends one request, immediately disables submission, and shows upload status.
- Failed upload displays its error inside the dialog, keeps the selected file and
  inputs, enables retry, and does not close the dialog.
- Successful retry closes the dialog and updates the list.
- Double-clicking Save sends one edit request. Saving shows progress, closes on
  success, and updates name/description without another `/api/me` request or a
  full-page reload.
- Moving the file to trash displays progress and updates the list.
- Double-clicking permanent deletion sends one request; both confirmation buttons
  are disabled while pending. Failure stays in the confirmation with an error.
- Successful deletion retry removes both dialogs and the trashed item without
  clicking Cancel. Dialog and alertdialog counts both become zero.
- Failed list reads show an explicit error and a working Reload List button;
  loading does not claim the library is empty.

The separate `npm run test:access` suite checks the real local D1/R2 API (24 checks).
It uses port 3212 and `work/access-smoke-state`, isolated from normal local dev data.
