from __future__ import annotations

from pathlib import Path
from typing import Iterable

from agno.tools import Toolkit

from .bridge import get_project_workspace_root, resolve_workspace_path


def _iter_tree(
    root: Path,
    workspace_root: Path,
    *,
    max_depth: int,
    include_hidden: bool,
    current_depth: int = 0,
) -> Iterable[str]:
    if current_depth > max_depth:
        return

    entries = sorted(root.iterdir(), key=lambda item: (item.is_file(), item.name.lower()))
    for entry in entries:
        if not include_hidden and entry.name.startswith("."):
            continue

        relative = entry.relative_to(workspace_root).as_posix()
        suffix = "/" if entry.is_dir() else ""
        yield relative + suffix

        if entry.is_dir():
            yield from _iter_tree(
                entry,
                workspace_root=workspace_root,
                max_depth=max_depth,
                include_hidden=include_hidden,
                current_depth=current_depth + 1,
            )


class WorkspaceFileTools(Toolkit):
    def __init__(self, workspace_root: Path | None = None):
        self.workspace_root = workspace_root.resolve() if workspace_root else None
        super().__init__(
            name="workspace_files",
            tools=[
                self.list_workspace_tree,
                self.glob_workspace,
                self.read_text_file,
                self.write_text_file,
                self.replace_in_file,
                self.make_directory,
                self.delete_path,
            ],
            requires_confirmation_tools=[
                "write_text_file",
                "replace_in_file",
                "delete_path",
            ],
            show_result_tools=[
                "list_workspace_tree",
                "glob_workspace",
                "read_text_file",
            ],
        )

    def _workspace_root(self) -> Path:
        return self.workspace_root or get_project_workspace_root()

    def list_workspace_tree(
        self,
        path: str = ".",
        max_depth: int = 2,
        include_hidden: bool = False,
        limit: int = 200,
    ) -> str:
        """
        List files and directories inside the workspace.

        Args:
            path: Relative path from the workspace root.
            max_depth: Maximum directory depth to traverse.
            include_hidden: Include dotfiles and hidden folders when true.
            limit: Maximum number of entries to return.
        """
        workspace_root = self._workspace_root()
        target = resolve_workspace_path(path, base_dir=workspace_root)
        if not target.is_dir():
            raise ValueError(f"Not a directory: {path}")

        entries = list(
            _iter_tree(
                target,
                workspace_root=workspace_root,
                max_depth=max_depth,
                include_hidden=include_hidden,
            )
        )
        visible = entries[:limit]
        body = "\n".join(visible) if visible else "(empty)"
        if len(entries) > limit:
            body += f"\n... truncated {len(entries) - limit} additional entries"
        return body

    def glob_workspace(
        self,
        pattern: str,
        base_path: str = ".",
        limit: int = 200,
    ) -> str:
        """
        Match files inside the workspace using a glob pattern.

        Args:
            pattern: Glob pattern, for example `src/**/*.ts`.
            base_path: Relative path used as the search root.
            limit: Maximum number of matches to return.
        """
        workspace_root = self._workspace_root()
        target = resolve_workspace_path(base_path, base_dir=workspace_root)
        if not target.is_dir():
            raise ValueError(f"Not a directory: {base_path}")

        matches = sorted(
            {
                path.relative_to(workspace_root).as_posix()
                for path in target.glob(pattern)
                if path.exists()
            }
        )
        visible = matches[:limit]
        body = "\n".join(visible) if visible else "(no matches)"
        if len(matches) > limit:
            body += f"\n... truncated {len(matches) - limit} additional matches"
        return body

    def read_text_file(
        self,
        path: str,
        start_line: int = 1,
        end_line: int | None = None,
    ) -> str:
        """
        Read a UTF-8 text file from the workspace.

        Args:
            path: Relative file path.
            start_line: First line number to include, 1-based.
            end_line: Last line number to include, 1-based. Leave empty for EOF.
        """
        workspace_root = self._workspace_root()
        target = resolve_workspace_path(path, base_dir=workspace_root)
        if target.is_dir():
            raise ValueError(f"Path is a directory: {path}")

        content = target.read_text(encoding="utf-8")
        lines = content.splitlines()
        start_index = max(start_line - 1, 0)
        end_index = len(lines) if end_line is None else min(end_line, len(lines))
        window = lines[start_index:end_index]

        if not window:
            return "(no content in requested range)"

        return "\n".join(
            f"{start_index + index + 1:>5}: {line}" for index, line in enumerate(window)
        )

    def write_text_file(self, path: str, content: str, create_dirs: bool = True) -> str:
        """
        Write or overwrite a UTF-8 text file inside the workspace.

        Args:
            path: Relative file path.
            content: Full file content.
            create_dirs: Create parent directories automatically when true.
        """
        workspace_root = self._workspace_root()
        target = resolve_workspace_path(
            path,
            allow_missing=True,
            base_dir=workspace_root,
        )
        if create_dirs:
            target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return f"Wrote {target.relative_to(workspace_root).as_posix()} ({len(content)} chars)."

    def replace_in_file(
        self,
        path: str,
        search_text: str,
        replace_text: str,
        replace_all: bool = False,
    ) -> str:
        """
        Replace text inside a UTF-8 file.

        Args:
            path: Relative file path.
            search_text: Exact text to search for.
            replace_text: Replacement text.
            replace_all: Replace every occurrence when true.
        """
        if not search_text:
            raise ValueError("search_text cannot be empty")

        workspace_root = self._workspace_root()
        target = resolve_workspace_path(path, base_dir=workspace_root)
        content = target.read_text(encoding="utf-8")
        occurrences = content.count(search_text)
        if occurrences == 0:
            raise ValueError(f"Text not found in {path}")

        updated = (
            content.replace(search_text, replace_text)
            if replace_all
            else content.replace(search_text, replace_text, 1)
        )
        target.write_text(updated, encoding="utf-8")
        replaced = occurrences if replace_all else 1
        return f"Updated {path}. Replaced {replaced} occurrence(s)."

    def make_directory(self, path: str) -> str:
        """
        Create a directory inside the workspace.

        Args:
            path: Relative directory path.
        """
        target = resolve_workspace_path(
            path,
            allow_missing=True,
            base_dir=self._workspace_root(),
        )
        target.mkdir(parents=True, exist_ok=True)
        return f"Created directory {target.relative_to(self._workspace_root()).as_posix()}/"

    def delete_path(self, path: str, recursive: bool = False) -> str:
        """
        Delete a file or directory inside the workspace.

        Args:
            path: Relative path to remove.
            recursive: Required for deleting directories.
        """
        target = resolve_workspace_path(path, base_dir=self._workspace_root())

        if target.is_dir():
            if not recursive:
                raise ValueError("recursive=True is required to delete a directory")
            for child in sorted(target.rglob("*"), reverse=True):
                if child.is_file() or child.is_symlink():
                    child.unlink()
                elif child.is_dir():
                    child.rmdir()
            target.rmdir()
        else:
            target.unlink()

        return f"Deleted {path}"
