export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAnnouncementScheduler } = await import(
      "./lib/announcement-scheduler"
    );
    startAnnouncementScheduler();
  }
}
