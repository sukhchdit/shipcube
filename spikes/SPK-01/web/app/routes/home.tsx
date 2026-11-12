import { useParams } from 'react-router';

export function meta() {
  return [{ title: 'SPK-01 prerender hello' }];
}

export default function Home() {
  const { lang } = useParams();
  return <h1 className="text-2xl font-bold">SPK-01 hello ({lang})</h1>;
}
