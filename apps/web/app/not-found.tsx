import { PageHeader } from '@/components/layout/PageHeader';
import { ButtonLink } from '@/components/ui/Button';
import styles from './not-found.module.scss';

export default function NotFound() {
  return (
    <>
      <PageHeader title="Page not found" />
      <div className={styles.body}>
        <p className={styles.description}>This page does not exist.</p>
        <ButtonLink href="/">Go to Overview</ButtonLink>
      </div>
    </>
  );
}
