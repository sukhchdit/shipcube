import { ErrorView } from '../components/error-view';

/** Catch-all for URLs that are not an admin page. */
export default function NotFound() {
  return <ErrorView kind="not-found" />;
}
