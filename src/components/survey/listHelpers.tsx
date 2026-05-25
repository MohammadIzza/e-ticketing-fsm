import { useEffect, useMemo, useState } from "react";

/** Hook untuk daftar dengan search + pagination client-side. */
export interface ListState<T> {
  search: string;
  setSearch: (s: string) => void;
  page: T[];
  pageIndex: number;
  setPageIndex: (i: number) => void;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function useListState<T>(
  source: T[],
  predicate: (item: T, q: string) => boolean,
  pageSize = 10,
): ListState<T> {
  const [search, setSearch] = useState("");
  const [pageIndex, setPageIndex] = useState(0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return source;
    return source.filter((item) => predicate(item, q));
  }, [source, search, predicate]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Reset page bila filter mengecilkan jumlah halaman.
  useEffect(() => {
    if (pageIndex > totalPages - 1) setPageIndex(0);
  }, [pageIndex, totalPages]);

  const start = pageIndex * pageSize;
  const page = filtered.slice(start, start + pageSize);

  return {
    search,
    setSearch,
    page,
    pageIndex,
    setPageIndex,
    pageSize,
    total,
    totalPages,
  };
}

/** Toolbar standar di atas daftar (search + filter slot). */
export function ListToolbar(props: {
  searchValue: string;
  onSearch: (s: string) => void;
  placeholder?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="list-toolbar">
      <input
        type="search"
        className="list-toolbar__search"
        placeholder={props.placeholder ?? "Cari..."}
        value={props.searchValue}
        onChange={(e) => props.onSearch(e.target.value)}
      />
      {props.children}
    </div>
  );
}

/** Pagination sederhana (Prev / Next + counter). */
export function Pager<T>({ state }: { state: ListState<T> }) {
  if (state.total === 0) return null;
  const start = state.pageIndex * state.pageSize + 1;
  const end = Math.min(state.total, (state.pageIndex + 1) * state.pageSize);
  return (
    <div className="pager">
      <span>
        {start}–{end} dari {state.total}
      </span>
      <div className="pager__btns">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={state.pageIndex === 0}
          onClick={() => state.setPageIndex(state.pageIndex - 1)}
        >
          ← Prev
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={state.pageIndex >= state.totalPages - 1}
          onClick={() => state.setPageIndex(state.pageIndex + 1)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
