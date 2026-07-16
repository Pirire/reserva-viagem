// ISO week helpers (sem bibliotecas externas)

export function getIsoWeekYear(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // quinta-feira decide o ano ISO
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const isoYear = d.getUTCFullYear();

  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);

  return { year: isoYear, week: weekNo };
}

export function getMonthYear(date = new Date()) {
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

// início da semana ISO (segunda 00:00)
export function startOfIsoWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay() || 7; // domingo=7
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (day - 1));
  return d;
}

// fim da semana ISO (domingo 23:59:59.999)
export function endOfIsoWeek(date = new Date()) {
  const start = startOfIsoWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function startOfMonth(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfMonth(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  d.setHours(23, 59, 59, 999);
  return d;
}
