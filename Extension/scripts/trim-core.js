"use strict";

(function installTrimCore(root, factory) {
  const core = factory();

  root.__CHATGPT_TOOLS_TRIM_CORE__ = core;

  if (typeof module === "object" && module.exports) {
    module.exports = core;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createTrimCore() {
  const HIDDEN_ROLES = new Set(["system", "tool", "thinking"]);
  const MIN_KEEP = 1;
  const MAX_KEEP = 100;

  function isObject(value) {
    return value !== null && typeof value === "object";
  }

  function clampLimit(value) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) {
      return 10;
    }
    return Math.max(MIN_KEEP, Math.min(MAX_KEEP, parsed));
  }

  function roleOf(node) {
    const role = node?.message?.author?.role;
    return typeof role === "string" ? role : "";
  }

  function isVisibleNode(node) {
    const role = roleOf(node);
    return role.length > 0 && !HIDDEN_ROLES.has(role);
  }

  function buildActivePath(mapping, currentNodeId) {
    if (!isObject(mapping) || typeof currentNodeId !== "string") {
      return null;
    }

    const reversePath = [];
    const visited = new Set();
    let nodeId = currentNodeId;

    while (nodeId) {
      if (visited.has(nodeId)) {
        return null;
      }

      const node = mapping[nodeId];
      if (!isObject(node)) {
        return null;
      }

      visited.add(nodeId);
      reversePath.push(nodeId);

      const parent = node.parent;
      if (parent === null || typeof parent === "undefined" || parent === "") {
        break;
      }
      if (typeof parent !== "string") {
        return null;
      }

      nodeId = parent;
    }

    reversePath.reverse();
    return reversePath;
  }

  function countVisibleGroups(path, mapping) {
    let count = 0;
    let previousRole = null;

    for (const nodeId of path) {
      const node = mapping[nodeId];
      if (!isVisibleNode(node)) {
        continue;
      }

      const role = roleOf(node);
      if (role !== previousRole) {
        count += 1;
        previousRole = role;
      }
    }

    return count;
  }

  function findRetainedStart(path, mapping, limit) {
    let groupsSeen = 0;
    let previousRole = null;

    for (let index = path.length - 1; index >= 0; index -= 1) {
      const node = mapping[path[index]];
      if (!isVisibleNode(node)) {
        continue;
      }

      const role = roleOf(node);
      if (role !== previousRole) {
        groupsSeen += 1;
        previousRole = role;
      }

      if (groupsSeen > limit) {
        return index + 1;
      }
    }

    return 0;
  }

  function buildTrimmedMapping(path, mapping, startIndex) {
    const retainedVisibleIds = path
      .slice(startIndex)
      .filter((nodeId) => isVisibleNode(mapping[nodeId]));

    if (retainedVisibleIds.length === 0) {
      return null;
    }

    const firstPathId = path[0];
    const shouldKeepRoot = Boolean(
      firstPathId &&
      !isVisibleNode(mapping[firstPathId]) &&
      !retainedVisibleIds.includes(firstPathId)
    );

    const retainedIds = shouldKeepRoot
      ? [firstPathId, ...retainedVisibleIds]
      : retainedVisibleIds;

    const trimmedMapping = {};

    retainedIds.forEach((nodeId, index) => {
      const source = mapping[nodeId];
      const parent = index > 0 ? retainedIds[index - 1] : null;
      const child = index + 1 < retainedIds.length ? retainedIds[index + 1] : null;

      trimmedMapping[nodeId] = {
        ...source,
        parent,
        children: child ? [child] : []
      };
    });

    return {
      mapping: trimmedMapping,
      root: retainedIds[0],
      currentNode: retainedIds[retainedIds.length - 1],
      retainedVisibleIds
    };
  }

  function trimConversation(conversation, requestedLimit) {
    if (!isObject(conversation)) {
      return null;
    }

    const mapping = conversation.mapping;
    const currentNodeId = conversation.current_node;
    const path = buildActivePath(mapping, currentNodeId);
    if (!path || path.length === 0) {
      return null;
    }

    const limit = clampLimit(requestedLimit);
    const visibleTotal = countVisibleGroups(path, mapping);

    if (visibleTotal <= limit) {
      return {
        changed: false,
        conversation,
        stats: {
          totalBefore: visibleTotal,
          keptAfter: visibleTotal,
          removed: 0,
          limit
        }
      };
    }

    const startIndex = findRetainedStart(path, mapping, limit);
    const trimmed = buildTrimmedMapping(path, mapping, startIndex);
    if (!trimmed) {
      return null;
    }

    const visibleKept = countVisibleGroups(trimmed.retainedVisibleIds, mapping);
    const result = {
      ...conversation,
      mapping: trimmed.mapping,
      current_node: trimmed.currentNode,
      root: trimmed.root
    };

    return {
      changed: true,
      conversation: result,
      stats: {
        totalBefore: visibleTotal,
        keptAfter: visibleKept,
        removed: Math.max(0, visibleTotal - visibleKept),
        limit
      }
    };
  }

  return Object.freeze({
    MIN_KEEP,
    MAX_KEEP,
    clampLimit,
    isVisibleNode,
    buildActivePath,
    trimConversation
  });
});
