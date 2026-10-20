export function latest<T extends { shortcode: string; publishedAt: string }>(
  posts: T[],
  limit: number,
): T[] {
  return [...new Map(posts.map((p) => [p.shortcode, p])).values()]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, limit);
}
interface PostDate {
  publishedAt?: string | null;
  metadataDate?: string | null;
}

function sortDate(post: PostDate): number {
  if (post.publishedAt) {
    const time = Date.parse(post.publishedAt);
    if (Number.isFinite(time)) return time;
  }
  // Metadata dates have no timezone or time of day; use them only for approximate ordering.
  const match = post.metadataDate?.match(/^([A-Za-z]+) (\d{1,2}), (\d{4})$/);
  if (!match) return -Infinity;
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const month = months.indexOf(match[1]);
  const day = Number(match[2]),
    year = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  return month >= 0 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month &&
    date.getUTCDate() === day
    ? date.getTime()
    : -Infinity;
}

export function comparePostsNewest(a: PostDate, b: PostDate): number {
  const left = sortDate(a),
    right = sortDate(b);
  return left === right ? 0 : left > right ? -1 : 1;
}
