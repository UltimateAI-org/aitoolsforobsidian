# Development Logs

This folder contains session-based development logs for tracking work on the AI Tools plugin.

## Purpose

- Document features implemented, bugs fixed, and decisions made
- Track development progress over time
- Provide rollback information if needed
- Share context with collaborators or future you

## Naming Convention

`YYYY-MM-DD-brief-description.md`

**Examples**:
- `2026-02-11-permission-other-option-and-fixes.md`
- `2026-02-15-session-history-refactor.md`
- `2026-03-01-performance-optimization.md`

## Log Template

```markdown
# Development Log - [Date]

## Session: [Brief Title]

**Duration**: [Time spent]
**Version**: [Current version]
**Agent**: [ACP agent used, if applicable]

---

## 🎯 Features Implemented

### 1. [Feature Name]
**Status**: ✅ Complete / 🚧 In Progress / ❌ Blocked

[Description]

**Files Modified**:
- `path/to/file.ts` - [What changed]

**Key Design Decisions**:
- [Decision 1]
- [Decision 2]

**Rollback Info**:
[How to undo this change]

---

## 🐛 Bugs Fixed

### 1. [Bug Title]
**Status**: ✅ Fixed

**Problem**: [Description]
**Root Cause**: [Analysis]
**Solution**: [How it was fixed]
**Files Modified**: [List]

---

## 🔍 Investigations

### 1. [Issue Investigated]
**Findings**: [What you learned]
**Next Steps**: [What to do]

---

## 🧪 Testing Required

- [ ] Test case 1
- [ ] Test case 2

---

## 🎓 Lessons Learned

1. [Lesson 1]
2. [Lesson 2]

---

## 🚀 Next Steps

1. [Action item 1]
2. [Action item 2]

---

**End of Log**
```

## Tips

- **Write logs as you work** - Don't wait until the end
- **Be specific** - Include file paths, line numbers, code snippets
- **Document decisions** - Explain *why*, not just *what*
- **Include rollback info** - Help your future self undo things
- **Link related issues** - Reference GitHub issues, PRs, etc.

## Viewing History

To see all logs chronologically:
```bash
ls -lt dev-logs/*.md
```

To search logs:
```bash
grep -r "search term" dev-logs/
```
