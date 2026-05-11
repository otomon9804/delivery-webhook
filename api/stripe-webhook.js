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
