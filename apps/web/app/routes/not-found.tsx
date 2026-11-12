import { ErrorView } from '../components/error-view';

/** Catch-all for URLs that are not a locale page (for example `/es/unknown/`). */
export default function NotFound() {
  return <ErrorView kind="not-found" />;
}
