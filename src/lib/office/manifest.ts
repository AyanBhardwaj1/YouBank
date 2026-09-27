/**
 * The add-in manifest Excel and PowerPoint install from: one task pane (the YouBank agent) and a
 * YouBank button on the Home tab of both apps. Built from the site's origin, so a preview deployment
 * serves a manifest that points at itself.
 */
export const ADDIN_ID = "8d3f5b2a-6c41-4e9f-a7d2-3b5c9e1f0a64";
export const ADDIN_VERSION = "1.0.0.0";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function host(type: "Workbook" | "Presentation", app: string) {
  const icons = `<Icon><bt:Image size="16" resid="Icon.16"/><bt:Image size="32" resid="Icon.32"/><bt:Image size="80" resid="Icon.80"/></Icon>`;
  return `
      <Host xsi:type="${type}">
        <DesktopFormFactor>
          <GetStarted>
            <Title resid="GetStarted.Title"/>
            <Description resid="GetStarted.Description"/>
            <LearnMoreUrl resid="LearnMore.Url"/>
          </GetStarted>
          <FunctionFile resid="Commands.Url"/>
          <ExtensionPoint xsi:type="PrimaryCommandSurface">
            <OfficeTab id="TabHome">
              <Group id="YouBank.${app}.Group">
                <Label resid="Group.Label"/>
                ${icons}
                <Control xsi:type="Button" id="YouBank.${app}.Open">
                  <Label resid="Button.Label"/>
                  <Supertip>
                    <Title resid="Button.Label"/>
                    <Description resid="Button.${app}.Tooltip"/>
                  </Supertip>
                  ${icons}
                  <Action xsi:type="ShowTaskpane">
                    <TaskpaneId>YouBankPane</TaskpaneId>
                    <SourceLocation resid="Taskpane.Url"/>
                  </Action>
                </Control>
              </Group>
            </OfficeTab>
          </ExtensionPoint>
        </DesktopFormFactor>
      </Host>`;
}

export function manifestXml(origin: string): string {
  const o = esc(origin.replace(/\/$/, ""));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0" xmlns:ov="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="TaskPaneApp">
  <Id>${ADDIN_ID}</Id>
  <Version>${ADDIN_VERSION}</Version>
  <ProviderName>YouBank</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="YouBank"/>
  <Description DefaultValue="Your analyst inside Excel and PowerPoint: an agent that builds and edits models cell by cell while you watch, audits them, and keeps decks tied to the numbers."/>
  <IconUrl DefaultValue="${o}/office/icon-32.png"/>
  <HighResolutionIconUrl DefaultValue="${o}/office/icon-64.png"/>
  <SupportUrl DefaultValue="${o}/app/office"/>
  <AppDomains>
    <AppDomain>${o}</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Workbook"/>
    <Host Name="Presentation"/>
  </Hosts>
  <DefaultSettings>
    <SourceLocation DefaultValue="${o}/office/taskpane"/>
  </DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="VersionOverridesV1_0">
    <Hosts>${host("Workbook", "Excel")}${host("Presentation", "PowerPoint")}
    </Hosts>
    <Resources>
      <bt:Images>
        <bt:Image id="Icon.16" DefaultValue="${o}/office/icon-16.png"/>
        <bt:Image id="Icon.32" DefaultValue="${o}/office/icon-32.png"/>
        <bt:Image id="Icon.80" DefaultValue="${o}/office/icon-80.png"/>
      </bt:Images>
      <bt:Urls>
        <bt:Url id="Commands.Url" DefaultValue="${o}/office/commands"/>
        <bt:Url id="Taskpane.Url" DefaultValue="${o}/office/taskpane"/>
        <bt:Url id="LearnMore.Url" DefaultValue="${o}/app/office"/>
      </bt:Urls>
      <bt:ShortStrings>
        <bt:String id="GetStarted.Title" DefaultValue="YouBank is ready"/>
        <bt:String id="Group.Label" DefaultValue="YouBank"/>
        <bt:String id="Button.Label" DefaultValue="YouBank"/>
      </bt:ShortStrings>
      <bt:LongStrings>
        <bt:String id="GetStarted.Description" DefaultValue="Open YouBank from the Home tab, connect your account, and ask the agent to build or fix a model while you watch."/>
        <bt:String id="Button.Excel.Tooltip" DefaultValue="Open the YouBank agent: build DCFs, comps and LBOs from SEC data in this workbook, audit it, and format it like a banker."/>
        <bt:String id="Button.PowerPoint.Tooltip" DefaultValue="Open YouBank: insert decks linked to your model, refresh them when the numbers move, and run the brand check."/>
      </bt:LongStrings>
    </Resources>
  </VersionOverrides>
</OfficeApp>
`;
}
