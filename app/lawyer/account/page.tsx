import { redirect } from 'next/navigation'

export default function LawyerAccountRedirect() {
  redirect('/lawyer/profile')
}
