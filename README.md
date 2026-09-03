# Matthew Bridge

OpenAI-compatible local bridge for the CMU Matthew AI web application.

This project is an adaptation of `niawjunior/aipass-bridge`. The original
AiPASS implementation remains in `aipass-bridge/` for reference and attribution;
the active Matthew implementation lives in `matthew-core/` and `matthew-extension/`.

## Architecture

```text
VS Code / OpenAI-compatible client
        |
        v
127.0.0.1:8787
        |
        v
Matthew Bridge
        |
        | SSE job relay
        v
Chrome MV3 extension
        |
        v
https://matthew.cmu.ac.th
        |
        v
CMU Matthew AI
```

The bridge does not store a Matthew access token. The Chrome page reads the
already-authenticated Matthew session locally and makes the upstream request
from the Matthew origin. The local server only sees normalized response data.

## Quick start

```powershell
cd D:\matthew-bridge
npm.cmd run dev
```

Keep the terminal running. Then Chrome → `chrome://extensions` → Developer mode
→ Load unpacked → select:

```text
D:\matthew-bridge\matthew-extension
```

Open `https://matthew.cmu.ac.th/` in the same Chrome profile and sign in with
CMU Account. The extension popup should report **Connected**.

## Verify

```powershell
npm.cmd run doctor
npm.cmd run models
```

Expected bridge endpoint:

```text
http://127.0.0.1:8787/v1
```

## OpenAI-compatible example

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8787/v1",
    api_key="local"
)

r = client.chat.completions.create(
    model="gpt-5.5",
    messages=[{"role": "user", "content": "Hello from VS Code"}],
)
print(r.choices[0].message.content)
```

## CLI

```powershell
npm.cmd run matthew -- "สวัสดี Matthew Bridge"
npm.cmd run doctor
npm.cmd run models
```
