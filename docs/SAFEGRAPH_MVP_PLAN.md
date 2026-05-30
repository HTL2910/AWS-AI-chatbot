# KE HOACH PHAT TRIEN SAFEGRAPH AI (MVP)

Muc tieu: VS Code extension co sidebar chat, tu dong rut gon ngu canh theo do thi code, loc thong tin nhay cam, goi AWS Bedrock, streaming va nut Apply.

## Tuan 1: Sidebar Chat (Webview)

- Tao `WebviewViewProvider` va view trong sidebar.
- UI chat toi thieu: khung tin nhan, o nhap, nut Gui, hien thi tin nhan theo hang.
- Wire `postMessage`:
  - Webview -> Extension: userMessage
  - Extension -> Webview: assistantMessage (tam thoi echo) + error
- Quy uoc message schema (de giu on dinh khi them streaming):
  - `{ type: "userMessage", text, id, ts }`
  - `{ type: "assistantMessage", text, id, ts, done?: boolean }`
  - `{ type: "error", message, id?, ts }`

## Tuan 2: Code Graph + Token Budget

- Scan file bang `vscode.workspace.findFiles` (loc theo ngon ngu, bo node_modules/.git/dist).
- Trich xuat symbol:
  - MVP: regex + heuristic (function/class + import/export) de nhanh.
  - Nang cap: parser AST (ts-morph / tree-sitter) neu can do chinh xac.
- Xay do thi lien quan:
  - Edge: function A -> function B (call)
  - Chon subgraph dua theo file dang mo + symbol quanh cursor + hop nhat theo call depth.
- Tao context builder:
  - Gioi han token theo budget (so ky tu/byte cho MVP).
  - Uu tien: file dang mo -> symbol gan cursor -> dependency 1 hop -> 2 hop.

## Tuan 3: Security Filter + AWS Bedrock

- Local masking:
  - Regex detect: AWS keys, bearer tokens, passwords, URLs noi bo, secrets trong .env.
  - Replace bang placeholder co the truy vet: `***MASK:AWS_ACCESS_KEY_ID***`
- Bedrock client:
  - MVP: Bedrock API key (Authorization: Bearer) + `/converse`.
  - Later: IAM SigV4 via AWS SDK (khuyen nghi neu muon enterprise).
- Prompt contract:
  - System prompt co ranh gioi: khong tu y xuat secrets, chi dua patch.
  - User prompt = question + context builder output.

## Tuan 4: Streaming + Apply + Dong goi

- Streaming:
  - Su dung Bedrock streaming (ConverseStream) va UI append theo chunk.
- Apply:
  - Parse fenced code block.
  - Nhan "Apply" -> `TextEditor.edit` chen vao vi tri cursor hoac thay selection.
  - MVP: ap dung 1 code block; later: multi-file patch diff.
- Dong goi:
  - `vsce package` tao `.vsix`.

## Definition Of Done (MVP)

- Sidebar chat hoat dong, message roundtrip on dinh.
- Co the chon scope context (file dang mo / folder) va xem preview context.
- Masking chay truoc khi gui request.
- Goi Bedrock thanh cong va tra loi; streaming + Apply co ban.

