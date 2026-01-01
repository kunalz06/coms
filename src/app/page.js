import AuthForm from "@/components/AuthForm";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      {/* Background Gradients */}
      <div className={styles.gradientBlue} />
      <div className={styles.gradientPurple} />

      <div className={styles.content}>
        <AuthForm />
      </div>
    </main>
  );
}
