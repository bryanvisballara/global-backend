function addMonths(dateValue, months) {
  const date = new Date(dateValue);
  const nextDate = new Date(date);

  nextDate.setMonth(nextDate.getMonth() + months);

  return nextDate;
}

module.exports = {
  addMonths,
};