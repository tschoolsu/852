export const ACCESS_LEVELS = new Set(["private", "selected", "members"]);

export function canAccessResource(resource, userId, selectedUserIds = []) {
  if (!resource || !userId) return false;
  if (resource.owner_id === userId) return true;
  if (resource.access_level === "members") return true;
  return resource.access_level === "selected" && selectedUserIds.includes(userId);
}

export function normalizeAccessLevel(value) {
  return ACCESS_LEVELS.has(value) ? value : "private";
}
