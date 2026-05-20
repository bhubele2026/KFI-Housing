import { useTranslation } from "react-i18next";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Placeholder page rendered for every `/transport/...` route while the real
 * Transportation sub-section is still on the roadmap. Each route passes its
 * own translation key for the section title (e.g. `nav.transport.vehicles`)
 * so operators see the same label they clicked in the sidebar — the body is
 * a single shared "Coming soon" line so any click on a Transportation nav
 * row stops landing on the 404 screen.
 */
export default function TransportStub({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  const title = t(titleKey);
  return (
    <MainLayout>
      <PageHeader
        title={title}
        description={t("transport.stub.description")}
      />
      <Card data-testid={`transport-stub-${titleKey}`}>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t("transport.stub.comingSoon")}
        </CardContent>
      </Card>
    </MainLayout>
  );
}
