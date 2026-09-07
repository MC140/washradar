import {Link} from 'react-router-dom';
export function NotFoundPage() {
  return <section className="empty-state"><h1>That route took a wrong turn.</h1><p>Return to nearby washes and keep comparing.</p><Link className="primary-button" to="/">Explore washes</Link></section>;
}
