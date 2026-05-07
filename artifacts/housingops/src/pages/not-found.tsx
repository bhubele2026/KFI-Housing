import { useTranslation } from "react-i18next";
import { NotFoundScreen } from "@/components/not-found-screen";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <NotFoundScreen
        title={t("notFound.title")}
        description={t("notFound.description")}
        testId="page-not-found"
      />
    </div>
  );
}
