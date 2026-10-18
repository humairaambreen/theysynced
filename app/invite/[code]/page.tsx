import InviteClient from './InviteClient';

export function generateStaticParams() {
  return [{ code: 'demo' }];
}

export default function InvitePage() {
  return <InviteClient />;
}
