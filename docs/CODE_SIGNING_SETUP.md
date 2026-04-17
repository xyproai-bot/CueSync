# Code Signing Setup

LTCast 目前在 GitHub Actions CI 上打包 macOS (Universal DMG/zip) 與 Windows (NSIS installer) 產物，但**尚未做正式的程式碼簽章**。本文件說明目前狀態、使用者影響，以及日後取得憑證後要怎麼一步步啟用 macOS notarization 和 Windows code signing。

---

## 1. 目前狀態

| 平台 | 狀態 | 檔案 / 流程 |
|------|------|-------------|
| macOS | **Ad-hoc signed** (自簽，無 Apple Developer ID) | `scripts/sign-mac.sh`、`scripts/afterPack.js`、`resources/entitlements.mac.plist` |
| Windows | **未簽章** (plain NSIS installer) | `electron-builder.js` `win` section |

### macOS Ad-hoc 簽章的意義

- 避開 macOS 15 Sequoia 的 "LTCast is damaged" 錯誤（未簽章的 Electron app 會直接被系統拒絕啟動）
- **不等於** notarization，Apple 公證伺服器從未看過這份 binary
- 使用者第一次開啟時仍會看到 "Apple could not verify ... is free of malware" 的警告
- 解法：使用者需**右鍵點擊 app → 選「打開」→ 再點一次「打開」**，之後才能正常使用

### Windows 未簽章的影響

- 安裝時會出現 **Microsoft Defender SmartScreen** 警告："Windows protected your PC"
- 使用者必須點「More info」→「Run anyway」才能繼續
- 這對非技術使用者是一大障礙，流失率很高

---

## 2. macOS Notarization 完整流程

### 2.1 前置需求

| 項目 | 說明 | 費用 |
|------|------|------|
| Apple Developer Program 會員 | 個人或機構帳號皆可 | USD $99 / 年 |
| Developer ID Application 憑證 | 由 Apple 簽發，用於 distribute outside Mac App Store | 包含在會員費內 |
| App-specific password | 用於 notarization CLI 登入 | 免費 |

註冊入口：<https://developer.apple.com/programs/>。個人帳號審核通常 24–48 小時，機構帳號（含 D-U-N-S 驗證）可能要一週以上。

### 2.2 建立 Developer ID Application 憑證

1. 登入 <https://developer.apple.com/account/resources/certificates/list>
2. 點 **+** 建立新憑證 → 選 **Developer ID Application**
3. 在本機用 Keychain Access 產生 CSR（Certificate Signing Request）
   - Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority
   - Email = Apple ID
   - Common Name = 你的名字或公司名
   - 選 "Saved to disk"
4. 上傳 CSR → 下載 `.cer` → 雙擊匯入 Keychain Access 的 **login** keychain
5. 在 Keychain Access 找到憑證（名稱像 `Developer ID Application: Your Name (TEAMID)`）
6. 右鍵 → **Export** → 存成 `.p12` 格式 → 設一個強密碼（這就是 `CSC_KEY_PASSWORD`）

### 2.3 取得 App-specific password

1. 登入 <https://appleid.apple.com/account/manage>
2. Sign-In and Security → App-Specific Passwords → **+**
3. 取個名字（例如 "LTCast notarization"）→ 儲存產生的密碼
4. **這個密碼不是 Apple ID 密碼**，不能互換

### 2.4 找到 Team ID

- <https://developer.apple.com/account> 右上角會顯示，或
- `Developer ID Application: Your Name (ABCD123XYZ)` 括號裡那串 10 字元就是 Team ID

### 2.5 將憑證編碼為 base64

```bash
base64 -i ~/Downloads/DeveloperID.p12 | pbcopy
```

（Windows：`certutil -encode DeveloperID.p12 DeveloperID.b64` 然後開 `.b64` 檔把中間的 base64 字串複製出來，去掉 `-----BEGIN/END CERTIFICATE-----`）

### 2.6 新增 GitHub repository secrets

到 <https://github.com/xyproai-bot/LTCast/settings/secrets/actions> 新增：

| Secret name | 內容 |
|-------------|------|
| `APPLE_ID` | Apple ID email |
| `APPLE_ID_PASSWORD` | App-specific password（步驟 2.3） |
| `APPLE_TEAM_ID` | Team ID（步驟 2.4） |
| `CSC_LINK` | base64 的 `.p12` 字串（步驟 2.5） |
| `CSC_KEY_PASSWORD` | 匯出 `.p12` 時設的密碼（步驟 2.2） |

### 2.7 修改 `electron-builder.js`

目前 `mac` section 長這樣：

```js
mac: {
  target: [
    { target: 'dmg', arch: ['universal'] },
    { target: 'zip', arch: ['universal'] }
  ],
  icon: 'resources/icon.icns',
  // Ad-hoc signed via afterPack hook — avoids "damaged" error on macOS 15
  identity: null
}
```

正式簽章後改為：

```js
mac: {
  target: [
    { target: 'dmg', arch: ['universal'] },
    { target: 'zip', arch: ['universal'] }
  ],
  icon: 'resources/icon.icns',
  hardenedRuntime: true,
  gatekeeperAssess: false,
  entitlements: 'resources/entitlements.mac.plist',
  entitlementsInherit: 'resources/entitlements.mac.plist',
  notarize: {
    teamId: process.env.APPLE_TEAM_ID
  }
  // 移除 identity: null，讓 electron-builder 自動挑 CSC_LINK 的憑證
}
```

### 2.8 停用 ad-hoc 簽章 hook

因為 electron-builder 會用真的 Developer ID 簽章，ad-hoc hook 要關掉：

**方案 A（推薦）**：在 `scripts/afterPack.js` 裡偵測環境變數，有正式憑證時跳過：

```js
exports.default = async function (context) {
  if (context.electronPlatformName !== 'mac') return
  if (process.env.CSC_LINK) {
    console.log('[afterPack] CSC_LINK present — skip ad-hoc sign')
    return
  }
  // ... 原有 ad-hoc 邏輯
}
```

**方案 B**：在 `electron-builder.js` 裡把 `afterPack` hook 註解掉（但本機還是會想要 ad-hoc 模式，不推薦）

### 2.9 現有 entitlements 檔可以直接用

`resources/entitlements.mac.plist` 已經有 Electron 需要的標準 entitlements：

```xml
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
<key>com.apple.security.cs.disable-library-validation</key><true/>
<key>com.apple.security.cs.allow-dyld-environment-variables</key><true/>
```

這是 V8/Electron 必需的 entitlements，不用改。之後如果加 MIDI 權限或其他系統 API，可能要加對應的 entitlement（例如 `com.apple.security.device.audio-input`）。

### 2.10 驗證 notarization

打完包後：

```bash
# 檢查簽章
codesign --verify --deep --strict --verbose=4 dist/mac-universal/LTCast.app

# 檢查 notarization ticket 是否 staple 上去
xcrun stapler validate dist/mac-universal/LTCast.app
spctl --assess --type execute --verbose dist/mac-universal/LTCast.app
# 預期輸出：accepted source=Notarized Developer ID
```

---

## 3. Windows Code Signing 完整流程

### 3.1 憑證類型比較

| 類型 | 成本 | SmartScreen 行為 | 適合 CI 自動簽章？ |
|------|------|------------------|--------------------|
| **EV Code Signing** | $300–600 / 年 | **立即**繞過 SmartScreen warning | 需 cloud HSM（SSL.com eSigner）或特殊設定 |
| **OV Code Signing** | $100–300 / 年 | 前 1–3 個月仍會跳 SmartScreen，累積下載量後才會被 Microsoft reputation system 信任 | 可以（一般 .pfx 檔） |
| **Self-signed** | 免費 | 完全沒作用，使用者還是要手動信任 | 可以但沒意義 |
| **不簽章**（目前狀態） | 免費 | SmartScreen warning 永遠存在 | — |

### 3.2 常見供應商

| 供應商 | EV 價格 | OV 價格 | 備註 |
|--------|---------|---------|------|
| **SSL.com** | $349 / 年 | $129 / 年 | EV 支援 **cloud eSigner**，適合 GitHub Actions |
| **DigiCert** | $474 / 年 | $289 / 年 | 大廠，SmartScreen 信譽累積快 |
| **Sectigo / Comodo** | $399 / 年 | $179 / 年 | — |
| **Certum** (Open Source) | — | 免費（限 open source 專案） | 只發 OV，LTCast 是 MIT/Open source 的話可以申請 |
| **GoGetSSL / reseller** | $300–400 | $80–150 | 便宜 reseller，但支援較少 |

**LTCast 的推薦**：

- 如果 repo 是 open source 且預算零 → **Certum Open Source**（免費 OV），申請需 2–4 週，要提供 GitHub repo 連結給 Certum 驗證
- 如果要 CI 自動簽章且預算有限 → **SSL.com EV with eSigner**（$349/年，cloud HSM 不用實體 USB token）
- 如果要最快讓 SmartScreen 放行 → **DigiCert EV**（最貴但信譽最好）

### 3.3 CI 自動簽章的障礙

傳統 EV cert 綁在實體 USB HSM token 上，只能本機插著 token 手動簽。要在 GitHub Actions 上自動簽章，方案只有兩個：

1. **Cloud-based EV cert**：SSL.com eSigner、DigiCert KeyLocker、Azure Key Vault — 憑證存在雲端 HSM，CI 透過 API 簽章。
2. **OV cert**：直接把 `.pfx` 存進 GitHub secret，走傳統 signtool。

（如果選了綁 USB token 的 EV cert，就只能本機打包、手動上傳到 GitHub Release — 失去 CI 自動化）

### 3.4 購入 OV / 一般 cert 後的設定

假設走 OV cert（`.pfx` 檔）：

#### 3.4.1 編碼憑證為 base64

```bash
# Mac / Linux
base64 -i cert.pfx | pbcopy
# Windows
certutil -encode cert.pfx cert.b64
```

#### 3.4.2 新增 GitHub secrets

| Secret name | 內容 |
|-------------|------|
| `WINDOWS_CERTIFICATE_BASE64` | base64 的 `.pfx` 內容 |
| `WINDOWS_CERTIFICATE_PASSWORD` | 匯出 `.pfx` 時設的密碼 |

#### 3.4.3 修改 `electron-builder.js`

目前 `win` section：

```js
win: {
  target: [
    { target: 'nsis', arch: ['x64'] }
  ],
  artifactName: '${productName}-Setup-${version}.${ext}'
}
```

改為：

```js
win: {
  target: [
    { target: 'nsis', arch: ['x64'] }
  ],
  artifactName: '${productName}-Setup-${version}.${ext}',
  signtoolOptions: {
    certificateSubjectName: 'Your Legal Entity Name', // 或用 certificateFile + certificatePassword
    signingHashAlgorithms: ['sha256'],
    rfc3161TimeStampServer: 'http://timestamp.digicert.com'
  }
}
```

electron-builder 會自動讀 `CSC_LINK` / `CSC_KEY_PASSWORD` 環境變數（跟 macOS 共用 secret name）。如果 Mac 和 Win 要用不同憑證，改用 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`。

#### 3.4.4 修改 `.github/workflows/build.yml`

在 `build-win` job 加環境變數：

```yaml
- name: Build and publish (Windows)
  run: |
    if ("${{ github.ref }}" -like "refs/tags/*") {
      npm run build && npx electron-builder --win --publish always
    } else {
      npm run build && npx electron-builder --win --publish never
    }
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    WIN_CSC_LINK: ${{ secrets.WINDOWS_CERTIFICATE_BASE64 }}
    WIN_CSC_KEY_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
```

同理 `build-mac` job 加：

```yaml
env:
  GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  APPLE_ID: ${{ secrets.APPLE_ID }}
  APPLE_ID_PASSWORD: ${{ secrets.APPLE_ID_PASSWORD }}
  APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
  CSC_LINK: ${{ secrets.CSC_LINK }}
  CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
```

### 3.5 SSL.com eSigner（cloud EV）設定

如果選 SSL.com eSigner：

1. 購買 SSL.com EV Code Signing → 完成身份驗證（需視訊）
2. 在 SSL.com 後台開通 eSigner → 設 TOTP authenticator
3. 用 CodeSignTool CLI（SSL.com 提供）在 CI 簽章，electron-builder 要走 custom sign hook：

```js
// electron-builder.js
win: {
  // ... existing config
  sign: './scripts/sign-windows-esigner.js'
}
```

`scripts/sign-windows-esigner.js` 內容參考 SSL.com 文件：<https://www.ssl.com/how-to/cloud-code-signing-integration-with-github-actions/>

GitHub secrets：

| Secret | 內容 |
|--------|------|
| `SSL_USERNAME` | SSL.com account username |
| `SSL_PASSWORD` | SSL.com account password |
| `SSL_CREDENTIAL_ID` | eSigner credential ID |
| `SSL_TOTP_SECRET` | TOTP 密鑰（用來在 CI 產生 OTP） |

### 3.6 驗證 Windows 簽章

下載打好的 installer 之後：

```powershell
Get-AuthenticodeSignature .\LTCast-Setup-0.5.0.exe
# 預期：Status = Valid, SignerCertificate 顯示你的名字/公司
```

或用 sigcheck（Sysinternals）：

```
sigcheck -a -h LTCast-Setup-0.5.0.exe
```

---

## 4. 實作順序建議

當 user 決定購買憑證後，建議照以下順序實作，每步都推一個 commit 方便 rollback：

### Phase A — macOS（單獨處理，不影響 Windows）

1. 新增 5 個 Apple GitHub secrets（`APPLE_ID` / `APPLE_ID_PASSWORD` / `APPLE_TEAM_ID` / `CSC_LINK` / `CSC_KEY_PASSWORD`）
2. 改 `electron-builder.js` 的 `mac` section（加 `hardenedRuntime`、`notarize`、`entitlements`，移除 `identity: null`）
3. 改 `scripts/afterPack.js`（偵測 `CSC_LINK` 時跳過 ad-hoc）
4. 改 `.github/workflows/build.yml` 的 `build-mac` job（加 env vars）
5. 推 tag 測試 → 下載 DMG 驗證 `spctl --assess` 通過

### Phase B — Windows（獨立）

1. 新增 Windows GitHub secrets
2. 改 `electron-builder.js` 的 `win` section
3. 改 `.github/workflows/build.yml` 的 `build-win` job（加 env vars）
4. 推 tag 測試 → 下載 installer 驗證 `Get-AuthenticodeSignature` 通過

### Phase C — 驗證

1. 在乾淨的 macOS VM 裡裝一次 DMG，確認不會跳「Apple could not verify」警告
2. 在乾淨的 Windows VM 裡跑一次 installer，確認 SmartScreen 直接放行（EV）或只出現標準 UAC（OV，需要累積信譽）

---

## 5. 目前可以做的事（零預算）

即使不花錢，仍有一些事情可以降低使用者摩擦：

### macOS

- 在 README / 下載頁加「**第一次打開請右鍵 → 選打開**」的截圖教學
- 考慮用 `hdiutil` 給 DMG 加個 `README-FIRST-LAUNCH.txt` 檔，裡面寫操作步驟

### Windows

- 在 README / 下載頁加「**點 More info → Run anyway**」的截圖
- Build artifact 的檔名保持穩定（`LTCast-Setup-0.5.0.exe`），累積下載量後 Microsoft SmartScreen reputation 會逐步改善
- 避免每版都換 installer 設定 / 檔名格式，會重置信譽

---

## 6. 相關檔案索引

| 檔案 | 用途 |
|------|------|
| `electron-builder.js` | 打包設定，`mac` / `win` section 是簽章主要設定點 |
| `scripts/afterPack.js` | Mac afterPack hook，目前叫 ad-hoc 簽章，加入 Developer ID 後要 gated by `CSC_LINK` |
| `scripts/sign-mac.sh` | Ad-hoc 簽章腳本，正式 notarization 後**不會再被呼叫** |
| `resources/entitlements.mac.plist` | Mac entitlements，notarization 時會直接沿用 |
| `.github/workflows/build.yml` | CI build 和 release，secrets 要透過 `env:` 傳給 electron-builder |

---

## 7. 參考資料

- electron-builder code signing: <https://www.electron.build/code-signing>
- electron-builder macOS notarization: <https://www.electron.build/configuration/mac.html#macnotarize>
- Apple notarization overview: <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>
- SSL.com eSigner + GitHub Actions: <https://www.ssl.com/how-to/cloud-code-signing-integration-with-github-actions/>
- Microsoft SmartScreen reputation: <https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/microsoft-defender-smartscreen-overview>
- Certum Open Source: <https://shop.certum.eu/data-safety/code-signing-certificates/open-source-code-signing.html>
