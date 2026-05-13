import { Redirect } from "wouter";

/**
 * Legacy `/login` route — preserved as a permanent redirect to the
 * Clerk sign-in page so existing bookmarks keep working.
 */
export default function Login() {
  return <Redirect to="/sign-in" />;
}
