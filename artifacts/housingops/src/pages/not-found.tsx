import { NotFoundScreen } from "@/components/not-found-screen";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <NotFoundScreen
        title="Page not found"
        description="We couldn't find the page you were looking for. It may have been moved or the record may have been deleted."
        testId="page-not-found"
      />
    </div>
  );
}
