# -*- coding: utf-8 -*-
"""
Универсальное обезличивание банковской выписки (любой формат/банк) —
с окошком выбора файла. Просто запустите этот файл —
откроется окно, где нужно выбрать файл выписки.
Обезличенный файл сохранится рядом с исходным, с припиской "_обезличено".

Что заменяется:
- ИНН (9-значные числа, слитно)
- Номера счетов (15+ цифр подряд, а также разбитые пробелами
  вида "20 208 000 300 600 257 009")
- Названия организаций — как отдельные ячейки, так и упоминания
  внутри более длинного текста (например, в колонке "Детали"/"Комментарий"),
  включая суффиксы MCHJ / МЧЖ / ХК / хусусий корхонаси / ООО / ЧП и т.п.
- Отдельно — поля "Наименование клиента:", "Клиент:" и подобные подписи,
  где после двоеточия идёт название организации без явного суффикса.
- Даты, суммы, коды документов, номера транзакций НЕ трогаются.

Требуется: pip install openpyxl
"""

import sys
import re
import hashlib
import os

try:
    import openpyxl
except ImportError:
    print("Не установлена библиотека openpyxl.")
    print("Откройте командную строку и выполните: pip install openpyxl")
    input("Нажмите Enter для выхода...")
    sys.exit(1)

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox
except ImportError:
    print("Модуль tkinter недоступен в этой версии Python.")
    input("Нажмите Enter для выхода...")
    sys.exit(1)


# --- Названия организаций внутри текста ---
ORG_SUFFIXES = r'(?:MCHJ|Mchj|МЧЖ|ХК|хусусий\s+корхонаси|корхонаси|ООО|ЧП|АО|ОАО|АТБ|ATB)'
ORG_PATTERNS = [
    r'["«][^"»]{2,60}["»]\s*' + ORG_SUFFIXES + r'?',
    r'\b[A-ZА-ЯЁ][\wА-ЯЁа-яё]*(?:\s+[A-ZА-ЯЁ][\wА-ЯЁа-яё]*){0,4}\s+' + ORG_SUFFIXES + r'\b',
]
ORG_REGEX = re.compile("|".join(ORG_PATTERNS))

# Подписи вида "Наименование клиента: ХХХ" / "Клиент: ХХХ" — берём остаток строки
LABELED_NAME_REGEX = re.compile(
    r'(Наименование\s+клиента|Клиент|Плательщик|Получатель)\s*:\s*(.+)',
    re.IGNORECASE
)

INN_REGEX = re.compile(r'\b\d{9}\b')

# Счёт слитно (15+ цифр) ИЛИ разбитый пробелами на группы (итого 15+ цифр)
ACCOUNT_REGEX = re.compile(r'\b\d{15,}\b')
ACCOUNT_SPACED_REGEX = re.compile(r'\b(?:\d{2,4}\s){4,}\d{2,4}\b')


def stable_id(value, prefix="ID"):
    h = hashlib.md5(str(value).strip().encode('utf-8')).hexdigest()[:8]
    return f"{prefix}_{h}"


class Anonymizer:
    def __init__(self):
        self.inn_cache = {}
        self.account_cache = {}
        self.org_cache = {}

    def replace_inn(self, match):
        val = match.group(0)
        if val == "000000000":
            return val
        if val not in self.inn_cache:
            self.inn_cache[val] = stable_id(val, "ИНН")
        return self.inn_cache[val]

    def replace_account(self, match):
        val = match.group(0)
        if val not in self.account_cache:
            self.account_cache[val] = stable_id(val, "СЧЕТ")
        return self.account_cache[val]

    def replace_account_spaced(self, match):
        val = match.group(0)
        # проверим, что цифр суммарно достаточно (не спутать с чем-то коротким)
        digits_only = re.sub(r'\D', '', val)
        if len(digits_only) < 12:
            return val
        if val not in self.account_cache:
            self.account_cache[val] = stable_id(val, "СЧЕТ")
        return self.account_cache[val]

    def replace_org(self, match):
        val = match.group(0)
        if val not in self.org_cache:
            self.org_cache[val] = stable_id(val, "ОРГ")
        return self.org_cache[val]

    def replace_labeled_name(self, match):
        label = match.group(1)
        name = match.group(2)
        if name not in self.org_cache:
            self.org_cache[name] = stable_id(name, "ОРГ")
        return f"{label}: {self.org_cache[name]}"

    def process_text(self, text):
        # Порядок: подписанные поля -> организации по суффиксам ->
        # счета (слитно/с пробелами) -> ИНН
        text = LABELED_NAME_REGEX.sub(self.replace_labeled_name, text)
        text = ORG_REGEX.sub(self.replace_org, text)
        text = ACCOUNT_SPACED_REGEX.sub(self.replace_account_spaced, text)
        text = ACCOUNT_REGEX.sub(self.replace_account, text)
        text = INN_REGEX.sub(self.replace_inn, text)
        return text

    def process_cell_value(self, value):
        if value is None:
            return value
        if not isinstance(value, str):
            return value
        if value.strip() == '':
            return value
        return self.process_text(value)


def anonymize_file(input_path, output_path):
    wb = openpyxl.load_workbook(input_path, data_only=True)
    az = Anonymizer()

    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                new_val = az.process_cell_value(cell.value)
                if new_val != cell.value:
                    cell.value = new_val

    wb.save(output_path)
    return len(az.inn_cache), len(az.account_cache), len(az.org_cache)


def main():
    root = tk.Tk()
    root.withdraw()

    input_path = filedialog.askopenfilename(
        title="Выберите файл выписки (.xlsx)",
        filetypes=[("Excel файлы", "*.xlsx"), ("Все файлы", "*.*")]
    )

    if not input_path:
        return

    base, ext = os.path.splitext(input_path)
    output_path = f"{base}_обезличено{ext}"

    try:
        inn_count, acc_count, org_count = anonymize_file(input_path, output_path)
        messagebox.showinfo(
            "Готово",
            f"Файл обезличен и сохранён:\n{output_path}\n\n"
            f"Заменено ИНН: {inn_count}\n"
            f"Заменено счетов: {acc_count}\n"
            f"Заменено наименований организаций: {org_count}\n\n"
            f"Даты, суммы и коды документов не изменялись."
        )
    except Exception as e:
        messagebox.showerror("Ошибка", f"Не удалось обработать файл:\n{e}")


if __name__ == "__main__":
    main()
