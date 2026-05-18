const crypto = require("crypto");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Vercelのbody parsingを無効化（生のbodyが必要）
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const rawBody = await getRawBody(req);

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("署名エラー:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (stripeEvent.type !== "checkout.session.completed") {
    return res.status(200).send("OK");
  }

  const session = stripeEvent.data.object;
  const customerEmail = session.customer_details?.email;
  if (!customerEmail) {
    return res.status(200).send("No email");
  }

  const licenseKey = generateLicenseKey(customerEmail);

  const mailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "DeliveryCalc <deliverycalc-info@bens-seints.com>",
      to: customerEmail,
      subject: "【DeliveryCalc】ライセンスキーとご利用手順のご案内",
      html: buildEmailBody(customerEmail, licenseKey),
      attachments: [
        {
          filename: "manifest.xml",
          content: Buffer.from(MANIFEST_XML).toString("base64"),
        },
        {
          filename: "DeliveryCalc_マニュアル.txt",
          content: Buffer.from(MANUAL_TXT).toString("base64"),
        },
      ],
    }),
  });

  if (!mailRes.ok) {
    const err = await mailRes.text();
    console.error("Resendエラー:", err);
    return res.status(500).send("Mail Error");
  }

  console.log(`✅ 送信完了: ${customerEmail} / ${licenseKey}`);
  return res.status(200).send("OK");
};

function generateLicenseKey(email) {
  const input = email.toLowerCase() + process.env.LICENSE_SECRET;
  const hash = crypto.createHash("sha256").update(input).digest("hex").toUpperCase();
  return `DC-${hash.slice(0,4)}-${hash.slice(4,8)}-${hash.slice(8,12)}`;
}

function buildEmailBody(email, key) {
  return `
<p>この度はDeliveryCalcをご購入いただき、誠にありがとうございます。</p>

<h3>📦 ライセンスキー</h3>
<p style="font-size:20px; font-weight:bold; letter-spacing:3px; color:#1a56db;">${key}</p>

<h3>🔧 セットアップ手順</h3>
<ol>
  <li>添付の <strong>manifest.xml</strong> を任意のフォルダに保存します</li>
  <li>Excelを開き、[ファイル] → [オプション] → [信頼センター] → [信頼できるアドインカタログ] からそのフォルダを登録します</li>
  <li>Excelを再起動し、[ホーム] タブの「納期管理を開く」をクリックします</li>
  <li>メールアドレス（<strong>${email}</strong>）と上記ライセンスキーを入力して認証します</li>
</ol>

<p>ご不明な点はお気軽にご連絡ください。</p>
<p>📧 サポート: <a href="mailto:deliverycalc-info@bens-seints.com">deliverycalc-info@bens-seints.com</a></p>
<br>
<p>── BensSeints</p>
`;
}

const MANUAL_TXT = `【DeliveryCalc】セットアップ・操作マニュアル

■ 1. マスターシートの初期化
サイドパネルの「マスタシート初期化」ボタンをクリックします。
以下の6シートが自動で作成されます。

  - TBL_MAKER         ：メーカーマスター
  - TBL_CUSTOMER      ：顧客マスター
  - TBL_WAREHOUSE     ：倉庫マスター
  - TBL_HOLIDAY       ：祝日マスター
  - TBL_ITEM_IRREGULAR：商品別イレギュラー
  - TBL_MAKER_IRREGULAR：メーカー別イレギュラー

※ TBL_WAREHOUSEにはサンプルデータ（WH001/WH002）が自動挿入されます。
※ 受注一覧シート（デフォルト名：受注一覧）は別途ご用意ください。


■ 2. 各マスターの入力項目

【TBL_MAKER：メーカーマスター】
  - Maker code    ：メーカーコード
  - Maker name    ：メーカー名
  - 受注締め時間  ：当日受注の締め時間
  - 納品曜日/日数 ：曜日モード時は納品曜日、日数モード時はリードタイム
  - 出荷日加算    ：加算する日数

【TBL_CUSTOMER：得意先マスター】
  - Customer code ：顧客コード
  - Customer name ：顧客名
  - 月〜日        ：納品可能な曜日（○×で入力）

【TBL_WAREHOUSE：倉庫マスター】
  - 倉庫コード    ：倉庫を識別するコード
  - 区分          ：「入荷」または「納品」
  - 稼働曜日      ：倉庫が稼働する曜日
  - 締め時間      ：倉庫の入荷締め時間

【TBL_HOLIDAY：祝日マスター】
  - 日付          ：祝日の日付
  - 祝日名        ：祝日の名称

【TBL_ITEM_IRREGULAR：商品別イレギュラー】
  - Customer code ：顧客コード
  - Item code     ：商品コード
  - 納品曜日/リードタイム：通常マスターを上書きする値

【TBL_MAKER_IRREGULAR：メーカー別イレギュラー】
  - Customer code ：顧客コード
  - Maker code    ：メーカーコード
  - 納品曜日/リードタイム：通常マスターを上書きする値


■ 3. 演算モードの選択
「曜日モード」または「日数モード」ボタンで切り替えます。

  - 曜日モード：メーカーごとに受注曜日→納品曜日のマッピングで計算
  - 日数モード：リードタイム（営業日数）で計算


■ 4. 列・シート設定（任意）
「⚙️ 列・シート設定を開く」ボタンで設定パネルを開きます。
受注一覧シートのシート名・各列番号を変更できます。

  変更可能な項目：
  - シート名
  - 顧客コード列
  - 品番列
  - メーカーコード列
  - 物流形態列
  - 入庫日列
  - 納品日列
  - 倉庫コード列

設定はExcel内に自動保存され、次回起動時に復元されます。


■ 5. 納期一括算出
受注データを受注一覧シートに入力後、
「納期一括算出」ボタンをクリックします。

納期の優先順位：
  TBL_ITEM_IRREGULAR → TBL_MAKER_IRREGULAR → 通常マスター`;

const MANIFEST_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0" xmlns:ov="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="TaskPaneApp">
  <Id>f1f9a2af-7311-41c3-9f8c-2daeaff0f968</Id>
  <Version>1.0.0.0</Version>
  <ProviderName>BensSeints</ProviderName>
  <DefaultLocale>ja-JP</DefaultLocale>
  <DisplayName DefaultValue="DeliveryCalc"/>
  <Description DefaultValue="納期クレームをゼロにするExcel"/>
  <IconUrl DefaultValue="https://otomon9804.github.io/delivery-calc-addin/dist/assets/icon-32.png"/>
  <HighResolutionIconUrl DefaultValue="https://otomon9804.github.io/delivery-calc-addin/dist/assets/icon-64.png"/>
  <SupportUrl DefaultValue="https://sites.google.com/view/delivery-calc/%E3%82%B5%E3%83%9D%E3%83%BC%E3%83%88"/>
  <AppDomains>
    <AppDomain>https://otomon9804.github.io/delivery-calc-addin/dist</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Workbook"/>
  </Hosts>
  <DefaultSettings>
    <SourceLocation DefaultValue="https://otomon9804.github.io/delivery-calc-addin/dist/taskpane.html"/>
  </DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="VersionOverridesV1_0">
    <Hosts>
      <Host xsi:type="Workbook">
        <DesktopFormFactor>
          <GetStarted>
            <Title resid="GetStarted.Title"/>
            <Description resid="GetStarted.Description"/>
            <LearnMoreUrl resid="GetStarted.LearnMoreUrl"/>
          </GetStarted>
          <ExtensionPoint xsi:type="PrimaryCommandSurface">
            <OfficeTab id="TabHome">
              <Group id="CommandsGroup">
                <Label resid="CommandsGroup.Label"/>
                <Icon>
                  <bt:Image size="16" resid="Icon.16x16"/>
                  <bt:Image size="32" resid="Icon.32x32"/>
                  <bt:Image size="80" resid="Icon.80x80"/>
                </Icon>
                <Control xsi:type="Button" id="TaskpaneButton">
                  <Label resid="TaskpaneButton.Label"/>
                  <Supertip>
                    <Title resid="TaskpaneButton.Label"/>
                    <Description resid="TaskpaneButton.Tooltip"/>
                  </Supertip>
                  <Icon>
                    <bt:Image size="16" resid="Icon.16x16"/>
                    <bt:Image size="32" resid="Icon.32x32"/>
                    <bt:Image size="80" resid="Icon.80x80"/>
                  </Icon>
                  <Action xsi:type="ShowTaskpane">
                    <TaskpaneId>ButtonId1</TaskpaneId>
                    <SourceLocation resid="Taskpane.Url"/>
                  </Action>
                </Control>
              </Group>
            </OfficeTab>
          </ExtensionPoint>
        </DesktopFormFactor>
      </Host>
    </Hosts>
    <Resources>
      <bt:Images>
        <bt:Image id="Icon.16x16" DefaultValue="https://otomon9804.github.io/delivery-calc-addin/dist/assets/icon-16.png"/>
        <bt:Image id="Icon.32x32" DefaultValue="https://otomon9804.github.io/delivery-calc-addin/dist/assets/icon-32.png"/>
        <bt:Image id="Icon.80x80" DefaultValue="https://otomon9804.github.io/delivery-calc-addin/dist/assets/icon-80.png"/>
      </bt:Images>
      <bt:Urls>
        <bt:Url id="GetStarted.LearnMoreUrl" DefaultValue="https://sites.google.com/view/delivery-calc/%E3%82%B5%E3%83%9D%E3%83%BC%E3%83%88"/>
        <bt:Url id="Functions.Runtime.Url" DefaultValue="https://otomon9804.github.io/delivery-calc-addin/dist/functions.html"/>
        <bt:Url id="Functions.Page.Url" DefaultValue="https://otomon9804.github.io/delivery-calc-addin/dist/functions.html"/>
        <bt:Url id="Functions.Metadata.Url" DefaultValue="https://otomon9804.github.io/delivery-calc-addin/dist/functions.json"/>
        <bt:Url id="Taskpane.Url" DefaultValue="https://otomon9804.github.io/delivery-calc-addin/dist/taskpane.html"/>
      </bt:Urls>
      <bt:ShortStrings>
        <bt:String id="GetStarted.Title" DefaultValue="DeliveryCalcへようこそ！"/>
        <bt:String id="CommandsGroup.Label" DefaultValue="DeliveryCalc"/>
        <bt:String id="TaskpaneButton.Label" DefaultValue="納期管理を開く"/>
      </bt:ShortStrings>
      <bt:LongStrings>
        <bt:String id="GetStarted.Description" DefaultValue="納期クレームをゼロにするExcelアドインが読み込まれました。"/>
        <bt:String id="TaskpaneButton.Tooltip" DefaultValue="DeliveryCalcの作業ウィンドウを開きます"/>
      </bt:LongStrings>
    </Resources>
  </VersionOverrides>
</OfficeApp>`;
