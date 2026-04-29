# Marketly Facebook Session Helper

## Load Unpacked

1. Open `chrome://extensions` or `edge://extensions`.
2. Turn on Developer mode.
3. Click `Load unpacked`.
4. Select this folder: `extension/facebook-session-helper`.

## Pairing Flow

1. Open Marketly `Facebook configuration`.
2. Generate a helper pairing code.
3. Open the extension options page.
4. Paste the pairing code.
5. Click `Pair helper`.

After pairing, the extension syncs only the required Facebook auth cookies (`c_user`, `xs`, `fr`, `datr`, `sb`) on startup and every 15 minutes. Keep Facebook open occasionally in Chrome/Edge so helper can refresh on startup and periodic sync. If the helper detects a local desync, it badges the toolbar icon and tries to open the helper popup; if Chrome blocks the popup, it shows a notification with quick actions.

## Privacy disclosure + consent

- The helper requests explicit consent in the popup/options UI before pairing or syncing.
- The helper uploads only the cookie fields needed by Marketly's backend session refresh flow.
- No browsing history, tabs content, or non-Facebook cookies are collected.

Production mode always uses:

```text
https://marketly-backend-870323632900.northamerica-northeast2.run.app
```

Developer mode is optional and only allows loopback API bases such as:

```text
http://127.0.0.1:8000
```

The options page also reads query params for prefill:

```text
options.html?pairing_code=PAIRING_CODE
```

For local development, `dev_api_base` can also be used with a loopback URL.

The deployed frontend can trigger one-click helper sync/pairing when it knows the extension ID:

```text
NEXT_PUBLIC_FACEBOOK_HELPER_EXTENSION_ID=<chrome-extension-id>
```

If that variable is not configured, Marketly falls back to opening/copying the pairing code and the helper's own auto-recovery prompts. Production web messaging is limited to `https://marketly.app`; local development is limited to `http://localhost/*` and `http://127.0.0.1/*`.

## Reliability behavior

- Transient API/network failures retry with exponential backoff and jitter.
- Retry attempts are capped; the options page shows `Next retry` and the last failure reason.
- When cookies are unchanged, the helper sends a heartbeat to `/connectors/facebook/helper/heartbeat` so Marketly can show the last check-in.
- `Sync now` forces a cookie upload attempt and clears successful retry state.

## Options status meanings

- `Not paired`: generate a fresh code in Marketly and pair again.
- `Paired / healthy`: the helper has a token and no current error.
- `Token invalid`: disconnect or forget the local token, then re-pair from Marketly.
- `Marketly API unreachable`: verify network connectivity. In developer mode, verify the local backend is running at `http://127.0.0.1:8000`.
- `Re-pair helper for this API mode`: the local token was created against a different API target. Delete the local token and pair again.
- `No Facebook cookies found`: open Facebook Marketplace in Chrome or Edge, sign in, then click `Sync now`.

## Troubleshooting

- Invalid token: re-pair the helper from Facebook Configuration.
- Wrong developer API base: production users do not enter an API base. For local development, enable Developer mode and use `http://127.0.0.1:8000`.
- Helper disconnected: open Facebook in Chrome/Edge and click `Sync Facebook cookies`; re-pair only if the helper token was deleted, revoked, or created for another API mode.
- Facebook checkpoint/login wall: resolve the Facebook prompt in the browser, then sync and re-verify in Marketly.
- Permission prompt denied: this only applies to developer mode. Click `Pair helper` again and allow the local API origin.
