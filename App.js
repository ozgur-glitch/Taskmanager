import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  Alert,
  SafeAreaView,
  StatusBar,
  Platform,
  Share,
  Modal,
  Switch,
  ScrollView
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

let FileSystem = null;
let DocumentPicker = null;
let Notifications = null;

try {
  FileSystem = require('expo-file-system');
} catch (e) {
  console.log('expo-file-system ist nicht verfügbar.');
}

try {
  DocumentPicker = require('expo-document-picker');
} catch (e) {
  console.log('expo-document-picker ist nicht verfügbar.');
}

try {
  Notifications = require('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch (e) {
  console.log('expo-notifications ist nicht verfügbar.');
}

const STORAGE_KEYS = {
  TASKS: '@taskmanager_tasks_v65',
  SETTINGS: '@taskmanager_settings_v65',
  CALENDAR: '@taskmanager_calendar_v65',
};

const TASK_CATEGORY = 'task_notification_category';
const ACTION_DONE = 'action_done';
const ACTION_POSTPONE = 'action_postpone';

const UNITS = [
  { label: 'Minuten', value: 'm', multiplier: 1 },
  { label: 'Stunden', value: 'h', multiplier: 60 },
  { label: 'Tage', value: 'd', multiplier: 1440 },
  { label: 'Wochen', value: 'w', multiplier: 10080 },
  { label: 'Monate', value: 'mo', multiplier: 43200 },
];

const RECURRENCE_OPTIONS = [
  { label: 'Einmalig', value: 'none' },
  { label: 'Täglich', value: 'daily' },
  { label: 'Wöchentlich', value: 'weekly' },
  { label: 'Monatlich', value: 'monthly' },
];

const CALENDAR_TYPES = [
  { label: 'zu Hause', value: 'free', color: '#10B981' },
  { label: 'Arbeit', value: 'work', color: '#6366F1' },
  { label: 'Schule', value: 'school', color: '#F59E0B' },
  { label: 'Urlaub', value: 'vacation', color: '#EC4899' },
  { label: 'Ferien', value: 'ferien', color: '#8B5CF6' },
];

// Berechnung von Ostern für die beweglichen hessischen Feiertage
const getEasterDate = (year) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
};

// Gesetzliche Feiertage für Hessen ermitteln
const getHessenHolidays = (year) => {
  const holidays = {};
  
  const formatDateKey = (d) => {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
  };

  holidays[`01.01.${year}`] = 'Neujahr';
  holidays[`01.05.${year}`] = 'Tag der Arbeit';
  holidays[`03.10.${year}`] = 'Tag der Deutschen Einheit';
  holidays[`25.12.${year}`] = '1. Weihnachtstag';
  holidays[`26.12.${year}`] = '2. Weihnachtstag';

  const easter = getEasterDate(year);
  
  const addDays = (date, days) => {
    const res = new Date(date.getTime());
    res.setDate(res.getDate() + days);
    return res;
  };

  holidays[formatDateKey(addDays(easter, -2))] = 'Karfreitag';
  holidays[formatDateKey(addDays(easter, 1))] = 'Ostermontag';
  holidays[formatDateKey(addDays(easter, 39))] = 'Christi Himmelfahrt';
  holidays[formatDateKey(addDays(easter, 50))] = 'Pfingstmontag';
  holidays[formatDateKey(addDays(easter, 60))] = 'Fronleichnam';

  return holidays;
};

const calculateReminderMinutes = (valueStr, unitValue) => {
  const val = parseInt(valueStr, 10);
  if (isNaN(val) || val <= 0) return 0;
  const unitObj = UNITS.find((u) => u.value === unitValue);
  const multiplier = unitObj ? unitObj.multiplier : 60;
  return val * multiplier;
};

const formatDDMMYYYY = (input) => {
  const cleaned = input.replace(/\D/g, '').slice(0, 8);
  if (cleaned.length <= 2) return cleaned;
  if (cleaned.length <= 4) return `${cleaned.slice(0, 2)}.${cleaned.slice(2)}`;
  return `${cleaned.slice(0, 2)}.${cleaned.slice(2, 4)}.${cleaned.slice(4)}`;
};

const formatHHMM = (input) => {
  const cleaned = input.replace(/\D/g, '').slice(0, 4);
  if (cleaned.length <= 2) return cleaned;
  return `${cleaned.slice(0, 2)}:${cleaned.slice(2)}`;
};

const isValidGermanDate = (dateStr) => {
  if (!dateStr || dateStr.length !== 10) return false;
  const parts = dateStr.split('.');
  if (parts.length !== 3) return false;

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  if (isNaN(day) || isNaN(month) || isNaN(year)) return false;
  if (month < 1 || month > 12) return false;
  if (year < 2000 || year > 2050) return false;

  const dateObj = new Date(year, month - 1, day);
  return (
    dateObj.getFullYear() === year &&
    dateObj.getMonth() === month - 1 &&
    dateObj.getDate() === day
  );
};

const parseDateString = (dateStr) => {
  if (!isValidGermanDate(dateStr)) return null;
  const [day, month, year] = dateStr.split('.').map(Number);
  return new Date(year, month - 1, day);
};

const formatDateObjToString = (dateObj) => {
  const d = String(dateObj.getDate()).padStart(2, '0');
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const y = dateObj.getFullYear();
  return `${d}.${m}.${y}`;
};

const isValidTime = (timeStr) => {
  if (!timeStr || timeStr.length !== 5) return false;
  const parts = timeStr.split(':');
  if (parts.length !== 2) return false;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes)) return false;
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
};

const parseDateTime = (dateStr, timeStr) => {
  if (!isValidGermanDate(dateStr)) return null;
  const [day, month, year] = dateStr.split('.').map(Number);
  let hours = 9;
  let minutes = 0;

  if (isValidTime(timeStr)) {
    const tParts = timeStr.split(':').map(Number);
    hours = tParts[0];
    minutes = tParts[1];
  }

  return new Date(year, month - 1, day, hours, minutes, 0);
};

const getNextRecurrenceDate = (dateStr, recurrence) => {
  let dateObj = parseDateTime(dateStr, '09:00');
  if (!dateObj) {
    const now = new Date();
    dateObj = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  if (recurrence === 'daily') {
    dateObj.setDate(dateObj.getDate() + 1);
  } else if (recurrence === 'weekly') {
    dateObj.setDate(dateObj.getDate() + 7);
  } else if (recurrence === 'monthly') {
    dateObj.setMonth(dateObj.getMonth() + 1);
  }

  const d = String(dateObj.getDate()).padStart(2, '0');
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const y = dateObj.getFullYear();
  return `${d}.${m}.${y}`;
};

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [textInput, setTextInput] = useState('');
  const [priority, setPriority] = useState('Mittel');
  const [dueDateInput, setDueDateInput] = useState('');
  const [dueTimeInput, setDueTimeInput] = useState('');
  
  const [reminderValue, setReminderValue] = useState('');
  const [reminderUnit, setReminderUnit] = useState('h');
  const [unitDropdownVisible, setUnitDropdownVisible] = useState(false);

  const [recurrence, setRecurrence] = useState('none');
  const [newSubtaskInputText, setNewSubtaskInputText] = useState('');
  const [createdSubtasks, setCreatedSubtasks] = useState([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [mainTab, setMainTab] = useState('Offen');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [settingsTab, setSettingsTab] = useState('personen'); // 'personen', 'serien', 'allgemein'
  const [manualModalVisible, setManualModalVisible] = useState(false);

  const [isLoaded, setIsLoaded] = useState(false);

  // Calendar State
  const [calendarPersons, setCalendarPersons] = useState([
    { name: 'Person 1', isMinor: false },
    { name: 'Person 2', isMinor: false },
    { name: 'Person 3', isMinor: true },
  ]);
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonIsMinor, setNewPersonIsMinor] = useState(false);
  const [calendarData, setCalendarData] = useState({});

  const currentYear = new Date().getFullYear();
  const [calendarEndYear, setCalendarEndYear] = useState(currentYear);

  const [jumpDateInput, setJumpDateInput] = useState('');
  const [alarmModalVisible, setAlarmModalVisible] = useState(false);

  const [seriesPerson, setSeriesPerson] = useState('');
  const [seriesStartDate, setSeriesStartDate] = useState('');
  const [seriesEndDate, setSeriesEndDate] = useState('');
  const [seriesWorkDays, setSeriesWorkDays] = useState('5');
  const [seriesFreeDays, setSeriesFreeDays] = useState('3');
  const [seriesWorkType, setSeriesWorkType] = useState('work');
  const [seriesFreeType, setSeriesFreeType] = useState('free');

  const seriesEndDateInputRef = useRef(null);

  const [statusPickerVisible, setStatusPickerVisible] = useState(false);
  const [selectedCellTarget, setSelectedCellTarget] = useState(null);

  const [editingPersonName, setEditingPersonName] = useState(null);
  const [editPersonInputText, setEditPersonInputText] = useState('');
  const [editPersonIsMinor, setEditPersonIsMinor] = useState(false);

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editText, setEditText] = useState('');
  const [editPriority, setEditPriority] = useState('Mittel');
  const [editDueDateInput, setEditDueDateInput] = useState('');
  const [editDueTimeInput, setEditDueTimeInput] = useState('');
  const [editReminderValue, setEditReminderValue] = useState('');
  const [editReminderUnit, setEditReminderUnit] = useState('h');
  const [editRecurrence, setEditRecurrence] = useState('none');
  const [editSubtasks, setEditSubtasks] = useState([]);
  const [newSubtaskText, setNewSubtaskText] = useState('');
  const [editUnitDropdownVisible, setEditUnitDropdownVisible] = useState(false);

  const dueDateInputRef = useRef(null);
  const dueTimeInputRef = useRef(null);
  const reminderInputRef = useRef(null);

  const editDueDateInputRef = useRef(null);
  const editDueTimeInputRef = useRef(null);

  const headerScrollRef = useRef(null);
  const verticalFlatListRef = useRef(null);
  const rowScrollRefs = useRef([]);
  const scrollPositionX = useRef(0);

  const handleHorizontalScroll = (offsetX) => {
    if (Math.abs(scrollPositionX.current - offsetX) < 1) return;
    scrollPositionX.current = offsetX;

    if (headerScrollRef.current) {
      headerScrollRef.current.scrollTo({ x: offsetX, animated: false });
    }

    rowScrollRefs.current.forEach((ref) => {
      if (ref) {
        ref.scrollTo({ x: offsetX, animated: false });
      }
    });
  };

  useEffect(() => {
    loadData();
    setupNotifications();
  }, []);

  useEffect(() => {
    if (isLoaded) {
      saveTasks(tasks);
    }
  }, [tasks, isLoaded]);

  useEffect(() => {
    if (isLoaded) {
      saveCalendarData(calendarPersons, calendarData);
    }
  }, [calendarPersons, calendarData, isLoaded]);

  const setupNotifications = async () => {
    if (!Notifications || Platform.OS === 'web') return;

    try {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        await Notifications.requestPermissionsAsync();
      }

      await Notifications.setNotificationCategoryAsync(TASK_CATEGORY, [
        {
          identifier: ACTION_DONE,
          buttonTitle: 'Erledigt ✓',
          options: { opensAppToForeground: false },
        },
        {
          identifier: ACTION_POSTPONE,
          buttonTitle: 'Auf morgen verschieben 📅',
          options: { opensAppToForeground: false },
        },
      ]);
    } catch (err) {
      console.log('Fehler beim Setup der Benachrichtigungen:', err);
    }
  };

  const scheduleTaskNotification = async (task) => {
    if (!Notifications || !task.dueDate || !task.reminderValue) return null;

    try {
      const dueDateObj = parseDateTime(task.dueDate, task.dueTime);
      if (!dueDateObj) return null;

      const offsetMinutes = calculateReminderMinutes(task.reminderValue, task.reminderUnit);
      if (offsetMinutes <= 0) return null;

      const triggerDate = new Date(dueDateObj.getTime() - offsetMinutes * 60 * 1000);
      if (triggerDate.getTime() <= Date.now()) return null;

      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: `⏰ Erinnerung: ${task.title}`,
          body: `Frist fällig am ${task.dueDate}${task.dueTime ? ` um ${task.dueTime}` : ''}!`,
          sound: true,
          categoryIdentifier: TASK_CATEGORY,
          data: { taskId: task.id },
        },
        trigger: triggerDate,
      });

      return notificationId;
    } catch (e) {
      console.log('Fehler beim Planen der Notification:', e);
      return null;
    }
  };

  const cancelTaskNotification = async (notificationId) => {
    if (Notifications && notificationId) {
      try {
        await Notifications.cancelScheduledNotificationAsync(notificationId);
      } catch (e) {
        console.log('Fehler beim Stornieren:', e);
      }
    }
  };

  const loadData = async () => {
    try {
      const storedTasks = await AsyncStorage.getItem(STORAGE_KEYS.TASKS);
      const storedSettings = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
      const storedCalendar = await AsyncStorage.getItem(STORAGE_KEYS.CALENDAR);

      if (storedTasks !== null) setTasks(JSON.parse(storedTasks));
      if (storedSettings !== null) {
        const settings = JSON.parse(storedSettings);
        setIsDarkMode(settings.isDarkMode ?? false);
      }
      if (storedCalendar !== null) {
        const cal = JSON.parse(storedCalendar);
        if (cal.persons) {
          const formattedPersons = cal.persons.map((p) =>
            typeof p === 'string' ? { name: p, isMinor: false } : p
          );
          setCalendarPersons(formattedPersons);
        }
        if (cal.data) setCalendarData(cal.data);
      }
    } catch (e) {
      Alert.alert('Fehler', 'Daten konnten nicht geladen werden.');
    } finally {
      setIsLoaded(true);
    }
  };

  const saveTasks = async (newTasks) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(newTasks));
    } catch (e) {
      console.log('Fehler beim Speichern:', e);
    }
  };

  const saveCalendarData = async (persons, data) => {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.CALENDAR,
        JSON.stringify({ persons, data })
      );
    } catch (e) {
      console.log('Fehler beim Speichern des Kalenders:', e);
    }
  };

  const toggleDarkMode = async (val) => {
    setIsDarkMode(val);
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.SETTINGS,
        JSON.stringify({ isDarkMode: val })
      );
    } catch (e) {
      console.log('Fehler beim Speichern:', e);
    }
  };

  const handleDueDateChange = (text) => {
    const formatted = formatDDMMYYYY(text);
    setDueDateInput(formatted);

    if (formatted.length === 10) {
      if (isValidGermanDate(formatted)) {
        dueTimeInputRef.current?.focus();
      } else {
        Alert.alert('Ungültiges Datum', 'Bitte gib ein gültiges Kalenderdatum ein.');
        setDueDateInput('');
        dueDateInputRef.current?.focus();
      }
    }
  };

  const handleDueDateBlur = () => {
    if (dueDateInput.length > 0 && !isValidGermanDate(dueDateInput)) {
      Alert.alert('Ungültiges Datum', 'Das eingegebene Datum ist ungültig. Bitte erneut eingeben.');
      setDueDateInput('');
      dueDateInputRef.current?.focus();
    }
  };

  const handleDueTimeChange = (text) => {
    const formatted = formatHHMM(text);
    setDueTimeInput(formatted);

    if (formatted.length === 5) {
      if (isValidTime(formatted)) {
        reminderInputRef.current?.focus();
      } else {
        Alert.alert('Ungültige Uhrzeit', 'Bitte gib eine gültige Uhrzeit ein.');
        setDueTimeInput('');
        dueTimeInputRef.current?.focus();
      }
    }
  };

  const handleDueTimeBlur = () => {
    if (dueTimeInput.length > 0 && !isValidTime(dueTimeInput)) {
      Alert.alert('Ungültige Uhrzeit', 'Die eingegebene Uhrzeit ist ungültig. Bitte erneut eingeben.');
      setDueTimeInput('');
      dueTimeInputRef.current?.focus();
    }
  };

  const handleEditDueDateChange = (text) => {
    const formatted = formatDDMMYYYY(text);
    setEditDueDateInput(formatted);

    if (formatted.length === 10) {
      if (isValidGermanDate(formatted)) {
        editDueTimeInputRef.current?.focus();
      } else {
        Alert.alert('Ungültiges Datum', 'Bitte gib ein gültiges Kalenderdatum ein.');
        setEditDueDateInput('');
        editDueDateInputRef.current?.focus();
      }
    }
  };

  const handleEditDueDateBlur = () => {
    if (editDueDateInput.length > 0 && !isValidGermanDate(editDueDateInput)) {
      Alert.alert('Ungültiges Datum', 'Das Datum ist ungültig. Bitte erneut eingeben.');
      setEditDueDateInput('');
      editDueDateInputRef.current?.focus();
    }
  };

  const handleEditDueTimeChange = (text) => {
    const formatted = formatHHMM(text);
    setEditDueTimeInput(formatted);

    if (formatted.length === 5) {
      if (!isValidTime(formatted)) {
        Alert.alert('Ungültige Uhrzeit', 'Bitte gib eine gültige Uhrzeit ein.');
        setEditDueTimeInput('');
        editDueTimeInputRef.current?.focus();
      }
    }
  };

  const handleEditDueTimeBlur = () => {
    if (editDueTimeInput.length > 0 && !isValidTime(editDueTimeInput)) {
      Alert.alert('Ungültige Uhrzeit', 'Die Uhrzeit ist ungültig. Bitte erneut eingeben.');
      setEditDueTimeInput('');
      editDueTimeInputRef.current?.focus();
    }
  };

  const handleSeriesStartDateChange = (text) => {
    const formatted = formatDDMMYYYY(text);
    setSeriesStartDate(formatted);
    if (formatted.length === 10) {
      if (isValidGermanDate(formatted)) {
        seriesEndDateInputRef.current?.focus();
      } else {
        Alert.alert('Ungültiges Datum', 'Bitte gib ein gültiges Startdatum ein.');
        setSeriesStartDate('');
      }
    }
  };

  const handleSeriesEndDateChange = (text) => {
    const formatted = formatDDMMYYYY(text);
    setSeriesEndDate(formatted);
  };

  const addCreatedSubtask = () => {
    if (newSubtaskInputText.trim() === '') return;
    const newSt = {
      id: `${Date.now()}_${Math.random()}`,
      title: newSubtaskInputText.trim(),
      completed: false,
    };
    setCreatedSubtasks([...createdSubtasks, newSt]);
    setNewSubtaskInputText('');
  };

  const removeCreatedSubtask = (stId) => {
    setCreatedSubtasks(createdSubtasks.filter((st) => st.id !== stId));
  };

  const addTask = async () => {
    if (textInput.trim() === '') {
      Alert.alert('Hinweis', 'Bitte gib eine Aufgabenbeschreibung ein.');
      return;
    }

    if (dueDateInput.length > 0 && !isValidGermanDate(dueDateInput)) {
      Alert.alert('Ungültiges Datum', 'Das Datum ist ungültig und wurde zurückgesetzt.');
      setDueDateInput('');
      dueDateInputRef.current?.focus();
      return;
    }

    if (dueTimeInput.length > 0 && !isValidTime(dueTimeInput)) {
      Alert.alert('Ungültige Uhrzeit', 'Die Uhrzeit ist ungültig und wurde zurückgesetzt.');
      setDueTimeInput('');
      dueTimeInputRef.current?.focus();
      return;
    }

    const newTask = {
      id: Date.now().toString(),
      title: textInput.trim(),
      priority: priority,
      dueDate: dueDateInput.length === 10 ? dueDateInput : null,
      dueTime: dueTimeInput.length === 5 ? dueTimeInput : null,
      reminderValue: reminderValue.trim(),
      reminderUnit: reminderUnit,
      recurrence: recurrence,
      subtasks: createdSubtasks,
      notificationId: null,
      completed: false,
      completedAt: null,
      createdAt: new Date().toLocaleDateString('de-DE'),
    };

    if (newTask.dueDate && newTask.reminderValue) {
      newTask.notificationId = await scheduleTaskNotification(newTask);
    }

    setTasks((prev) => [newTask, ...prev]);
    setTextInput('');
    setDueDateInput('');
    setDueTimeInput('');
    setReminderValue('');
    setRecurrence('none');
    setCreatedSubtasks([]);
    setNewSubtaskInputText('');
    
    setMainTab('Offen');
  };

  const startEditTask = (task) => {
    setEditingTaskId(task.id);
    setEditText(task.title);
    setEditPriority(task.priority);
    setEditDueDateInput(task.dueDate || '');
    setEditDueTimeInput(task.dueTime || '');
    setEditReminderValue(task.reminderValue || '');
    setEditReminderUnit(task.reminderUnit || 'h');
    setEditRecurrence(task.recurrence || 'none');
    setEditSubtasks(task.subtasks || []);
    setNewSubtaskText('');
    setEditModalVisible(true);
  };

  const saveEditedTask = async () => {
    if (editText.trim() === '') {
      Alert.alert('Hinweis', 'Die Beschreibung darf nicht leer sein.');
      return;
    }

    if (editDueDateInput.length > 0 && !isValidGermanDate(editDueDateInput)) {
      Alert.alert('Ungültiges Datum', 'Das Datum ist ungültig und wurde zurückgesetzt.');
      setEditDueDateInput('');
      editDueDateInputRef.current?.focus();
      return;
    }

    if (editDueTimeInput.length > 0 && !isValidTime(editDueTimeInput)) {
      Alert.alert('Ungültige Uhrzeit', 'Die Uhrzeit ist ungültig und wurde zurückgesetzt.');
      setEditDueTimeInput('');
      editDueTimeInputRef.current?.focus();
      return;
    }

    const targetTask = tasks.find((t) => t.id === editingTaskId);
    if (targetTask?.notificationId) {
      await cancelTaskNotification(targetTask.notificationId);
    }

    const updatedDueDate = editDueDateInput.length === 10 ? editDueDateInput : null;
    const updatedDueTime = editDueTimeInput.length === 5 ? editDueTimeInput : null;

    const tempTask = {
      id: editingTaskId,
      title: editText.trim(),
      dueDate: updatedDueDate,
      dueTime: updatedDueTime,
      reminderValue: editReminderValue.trim(),
      reminderUnit: editReminderUnit,
    };

    let newNotificationId = null;
    if (updatedDueDate && editReminderValue.trim() && !targetTask?.completed) {
      newNotificationId = await scheduleTaskNotification(tempTask);
    }

    setTasks(
      tasks.map((t) =>
        t.id === editingTaskId
          ? {
              ...t,
              title: editText.trim(),
              priority: editPriority,
              dueDate: updatedDueDate,
              dueTime: updatedDueTime,
              reminderValue: editReminderValue.trim(),
              reminderUnit: editReminderUnit,
              recurrence: editRecurrence,
              subtasks: editSubtasks,
              notificationId: newNotificationId,
            }
          : t
      )
    );

    setEditModalVisible(false);
    setEditingTaskId(null);
  };

  const toggleTask = async (id) => {
    const todayStr = new Date().toLocaleDateString('de-DE');
    let generatedTasks = [];

    const updatedTasks = await Promise.all(
      tasks.map(async (task) => {
        if (task.id === id) {
          const nextState = !task.completed;

          if (nextState && task.notificationId) {
            await cancelTaskNotification(task.notificationId);
          }

          let newNotificationId = task.notificationId;
          if (!nextState && task.dueDate && task.reminderValue) {
            newNotificationId = await scheduleTaskNotification(task);
          }

          if (nextState && task.recurrence && task.recurrence !== 'none') {
            const nextDueDate = getNextRecurrenceDate(task.dueDate, task.recurrence);
            const resetSubtasks = (task.subtasks || []).map((st) => ({ ...st, completed: false }));

            const nextRecurrentTask = {
              ...task,
              id: Date.now().toString(),
              dueDate: nextDueDate,
              completed: false,
              completedAt: null,
              subtasks: resetSubtasks,
              notificationId: null,
              createdAt: todayStr,
            };

            if (nextRecurrentTask.reminderValue) {
              nextRecurrentTask.notificationId = await scheduleTaskNotification(nextRecurrentTask);
            }
            generatedTasks.push(nextRecurrentTask);
          }

          return {
            ...task,
            completed: nextState,
            completedAt: nextState ? todayStr : null,
            notificationId: nextState ? null : newNotificationId,
          };
        }
        return task;
      })
    );

    setTasks([...generatedTasks, ...updatedTasks]);
  };

  const toggleSubtask = (taskId, subtaskId) => {
    setTasks((prev) =>
      prev.map((task) => {
        if (task.id === taskId) {
          const updatedSubtasks = (task.subtasks || []).map((st) =>
            st.id === subtaskId ? { ...st, completed: !st.completed } : st
          );
          return { ...task, subtasks: updatedSubtasks };
        }
        return task;
      })
    );
  };

  const addEditSubtask = () => {
    if (newSubtaskText.trim() === '') return;
    const newSt = {
      id: `${Date.now()}`,
      title: newSubtaskText.trim(),
      completed: false,
    };
    setEditSubtasks([...editSubtasks, newSt]);
    setNewSubtaskText('');
  };

  const removeEditSubtask = (stId) => {
    setEditSubtasks(editSubtasks.filter((st) => st.id !== stId));
  };

  const deleteTask = async (id) => {
    const taskToDelete = tasks.find((t) => t.id === id);
    if (taskToDelete?.notificationId) {
      await cancelTaskNotification(taskToDelete.notificationId);
    }

    Alert.alert('Löschen', 'Möchtest du diese Aufgabe wirklich löschen?', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () => setTasks(tasks.filter((task) => task.id !== id)),
      },
    ]);
  };

  const addCalendarPerson = () => {
    const trimmedName = newPersonName.trim();
    if (trimmedName === '') return;
    if (calendarPersons.some((p) => p.name === trimmedName)) {
      Alert.alert('Hinweis', 'Diese Person existiert bereits.');
      return;
    }
    setCalendarPersons([...calendarPersons, { name: trimmedName, isMinor: newPersonIsMinor }]);
    setNewPersonName('');
    setNewPersonIsMinor(false);
  };

  const startRenamePerson = (personObj) => {
    setEditingPersonName(personObj.name);
    setEditPersonInputText(personObj.name);
    setEditPersonIsMinor(personObj.isMinor);
  };

  const saveRenamePerson = () => {
    const trimmed = editPersonInputText.trim();
    if (trimmed === '') {
      Alert.alert('Hinweis', 'Der Name darf nicht leer sein.');
      return;
    }

    if (trimmed !== editingPersonName && calendarPersons.some((p) => p.name === trimmed)) {
      Alert.alert('Hinweis', 'Eine Person mit diesem Namen existiert bereits.');
      return;
    }

    const updatedPersons = calendarPersons.map((p) =>
      p.name === editingPersonName ? { name: trimmed, isMinor: editPersonIsMinor } : p
    );

    const updatedData = { ...calendarData };
    Object.keys(updatedData).forEach((key) => {
      if (key.endsWith(`_${editingPersonName}`)) {
        const datePart = key.split('_')[0];
        const newKey = `${datePart}_${trimmed}`;
        updatedData[newKey] = updatedData[key];
        delete updatedData[key];
      }
    });

    setCalendarPersons(updatedPersons);
    setCalendarData(updatedData);
    setEditingPersonName(null);
    setEditPersonInputText('');
  };

  const removeCalendarPerson = (personName) => {
    Alert.alert('Person löschen', `Möchtest du "${personName}" wirklich löschen?`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () => {
          setCalendarPersons(calendarPersons.filter((p) => p.name !== personName));
          const updatedData = { ...calendarData };
          Object.keys(updatedData).forEach((key) => {
            if (key.endsWith(`_${personName}`)) {
              delete updatedData[key];
            }
          });
          setCalendarData(updatedData);
        },
      },
    ]);
  };

  const handleCellPress = (dateStr, personName) => {
    const targetPerson = calendarPersons.find((p) => p.name === personName);
    const [d, m, y] = dateStr.split('.').map(Number);
    const holidays = getHessenHolidays(y);
    const isHoliday = !!holidays[dateStr];

    setSelectedCellTarget({ dateStr, personName, isMinor: targetPerson?.isMinor, isHoliday });
    setStatusPickerVisible(true);
  };

  const setCalendarStatusForSelectedCell = (statusValue) => {
    if (!selectedCellTarget) return;
    const { dateStr, personName, isMinor } = selectedCellTarget;

    if (isMinor && statusValue === 'work') {
      Alert.alert('Nicht erlaubt', 'Minderjährige können nicht auf den Status "Arbeit" gesetzt werden.');
      return;
    }

    const key = `${dateStr}_${personName}`;
    const updated = { ...calendarData };

    if (statusValue) {
      updated[key] = statusValue;
    } else {
      delete updated[key];
    }
    setCalendarData(updated);
    setStatusPickerVisible(false);
    setSelectedCellTarget(null);
  };

  const checkForMinorSupervisionIssues = (dataToCheck) => {
    const unsupervisedDates = [];
    const datesSet = new Set();
    Object.keys(dataToCheck).forEach((key) => {
      const parts = key.split('_');
      if (parts.length >= 2) datesSet.add(parts[0]);
    });
    
    calendarDays.forEach((d) => {
      if (!d.isHeader) datesSet.add(d.formatted);
    });

    datesSet.forEach((dateStr) => {
      let minorFree = false;
      let adultAvailable = false;

      const [d, m, y] = dateStr.split('.').map(Number);
      const holidays = getHessenHolidays(y);
      const isHoliday = !!holidays[dateStr];

      calendarPersons.forEach((p) => {
        const key = `${dateStr}_${p.name}`;
        let status = dataToCheck[key];

        if (!status && p.isMinor && isHoliday) {
          status = 'free';
        }

        if (p.isMinor && (status === 'free' || status === 'ferien' || (isHoliday && status !== 'work'))) {
          minorFree = true;
        }

        if (!p.isMinor && (status === 'free' || status === 'vacation')) {
          adultAvailable = true;
        }
      });

      if (minorFree && !adultAvailable) {
        unsupervisedDates.push(dateStr);
      }
    });

    unsupervisedDates.sort((a, b) => parseDateString(a) - parseDateString(b));

    return unsupervisedDates;
  };

  const generateCalendarSeries = () => {
    const targetPersonObj = calendarPersons.find((p) => p.name === seriesPerson) || calendarPersons[0];
    
    if (targetPersonObj.isMinor && seriesWorkType === 'work') {
      Alert.alert('Fehler', 'Minderjährige Personen können nicht mit "Arbeit" belegt werden.');
      return;
    }

    const targetPerson = targetPersonObj.name;
    const isTargetMinor = targetPersonObj.isMinor;
    const startObj = parseDateString(seriesStartDate);
    const endObj = parseDateString(seriesEndDate);

    if (!startObj || !endObj) {
      Alert.alert('Ungültiges Datum', 'Bitte gib ein gültiges Start- und Enddatum im Format TT.MM.JJJJ ein.');
      return;
    }

    if (startObj > endObj) {
      Alert.alert('Fehler', 'Das Startdatum darf nicht nach dem Enddatum liegen.');
      return;
    }

    const endYearOfSeries = endObj.getFullYear();
    if (endYearOfSeries > calendarEndYear) {
      setCalendarEndYear(Math.min(endYearOfSeries, 2050));
    }

    const wDays = parseInt(seriesWorkDays, 10);
    const fDays = parseInt(seriesFreeDays, 10);

    if (isNaN(wDays) || isNaN(fDays) || wDays < 0 || fDays < 0 || (wDays === 0 && fDays === 0)) {
      Alert.alert('Ungültige Tage', 'Bitte gib gültige Rhythmus-Zahlen ein.');
      return;
    }

    const updatedData = { ...calendarData };
    let curr = new Date(startObj.getTime());
    let cycleIndex = 0;
    const totalCycle = wDays + fDays;

    while (curr <= endObj) {
      const dateStr = formatDateObjToString(curr);
      const yearVal = curr.getFullYear();
      const holidays = getHessenHolidays(yearVal);
      const isHoliday = !!holidays[dateStr];

      const key = `${dateStr}_${targetPerson}`;

      if (isTargetMinor && isHoliday) {
        updatedData[key] = 'free';
      } else {
        const mod = cycleIndex % totalCycle;
        if (mod < wDays) {
          updatedData[key] = seriesWorkType;
        } else {
          updatedData[key] = seriesFreeType;
        }
      }

      curr.setDate(curr.getDate() + 1);
      cycleIndex++;
    }

    const unsupervised = checkForMinorSupervisionIssues(updatedData);
    setCalendarData(updatedData);

    if (unsupervised.length > 0) {
      setAlarmModalVisible(true);
    } else {
      Alert.alert('Erfolg', `Serieneinträge für "${targetPerson}" erfolgreich vom ${seriesStartDate} bis ${seriesEndDate} generiert! (Feiertage für Minderjährige wurden automatisch geschützt)`);
    }
  };

  const jumpToSpecificDate = (dateStr) => {
    const targetDateObj = parseDateString(dateStr);
    if (!targetDateObj) {
      Alert.alert('Ungültiges Datum', 'Bitte gib ein gültiges Datum im Format TT.MM.JJJJ ein.');
      return;
    }

    const targetYear = targetDateObj.getFullYear();
    if (targetYear > calendarEndYear) {
      setCalendarEndYear(Math.min(targetYear, 2050));
    }

    setTimeout(() => {
      const index = calendarDays.findIndex((d) => !d.isHeader && d.formatted === dateStr);
      if (index !== -1 && verticalFlatListRef.current) {
        const safeIndex = Math.max(0, index - 1);
        verticalFlatListRef.current.scrollToIndex({
          index: safeIndex,
          animated: true,
          viewPosition: 0,
        });
      } else {
        Alert.alert('Hinweis', 'Das Datum liegt außerhalb des geladenen Bereichs.');
      }
    }, 250);
  };

  const handleTaskBadgePress = (dateStr) => {
    setSearchQuery(dateStr);
    setMainTab('Offen');
  };

  const exportBackup = async () => {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const stores = await AsyncStorage.multiGet(allKeys);
      const backupData = {};

      stores.forEach(([key, value]) => {
        try {
          backupData[key] = JSON.parse(value);
        } catch {
          backupData[key] = value;
        }
      });

      const jsonString = JSON.stringify(backupData, null, 2);
      const fileName = `TaskKalender_Backup_${Date.now()}.json`;

      if (Platform.OS === 'android' && FileSystem && FileSystem.StorageAccessFramework) {
        const permissions =
          await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permissions.granted) {
          const uri = await FileSystem.StorageAccessFramework.createFileAsync(
            permissions.directoryUri,
            fileName,
            'application/json'
          );
          await FileSystem.writeAsStringAsync(uri, jsonString, {
            encoding: FileSystem.EncodingType.UTF8,
          });
          Alert.alert('Erfolg', 'Backup gespeichert!');
        }
      } else if (FileSystem && FileSystem.documentDirectory) {
        const fileUri = `${FileSystem.documentDirectory}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, jsonString, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        Alert.alert('Backup Erstellt', `Gespeichert unter:\n${fileUri}`);
      } else {
        await Share.share({ message: jsonString, title: fileName });
      }
    } catch (err) {
      Alert.alert('Export Fehler', err.message);
    }
  };

  const importBackup = async () => {
    if (!DocumentPicker) {
      Alert.alert('Fehler', 'Document Picker nicht verfügbar.');
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const fileUri = result.assets[0].uri;
      let content = '';

      if (FileSystem) {
        content = await FileSystem.readAsStringAsync(fileUri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      }

      const parsedData = JSON.parse(content);

      Alert.alert(
        'Wiederherstellung',
        'Möchtest du alle Daten überschreiben?',
        [
          { text: 'Abbrechen', style: 'cancel' },
          {
            text: 'Überschreiben',
            style: 'destructive',
            onPress: async () => {
              for (const [key, value] of Object.entries(parsedData)) {
                const strValue = typeof value === 'string' ? value : JSON.stringify(value);
                await AsyncStorage.setItem(key, strValue);
              }
              await loadData();
              setSettingsModalVisible(false);
              Alert.alert('Erfolg', 'Daten wiederhergestellt!');
            },
          },
        ]
      );
    } catch (err) {
      Alert.alert('Import Fehler', err.message);
    }
  };

  const theme = isDarkMode
    ? {
        bg: '#0F172A',
        cardBg: '#1E293B',
        text: '#F8FAFC',
        textMuted: '#94A3B8',
        accent: '#6366F1',
        border: '#334155',
        priorityHigh: '#EF4444',
        priorityMed: '#F59E0B',
        priorityLow: '#10B981',
      }
    : {
        bg: '#F8FAFC',
        cardBg: '#FFFFFF',
        text: '#0F172A',
        textMuted: '#64748B',
        accent: '#4F46E5',
        border: '#CBD5E1',
        priorityHigh: '#EF4444',
        priorityMed: '#F59E0B',
        priorityLow: '#10B981',
      };

  const filteredTasks = tasks.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const dateA = parseDateTime(a.dueDate, a.dueTime);
    const dateB = parseDateTime(b.dueDate, b.dueTime);
    if (dateA && !dateB) return -1;
    if (!dateA && dateB) return 1;
    if (!dateA && !dateB) return 0;
    return dateA - dateB;
  }).filter((task) => {
    if (mainTab === 'Offen' && task.completed) return false;
    if (mainTab === 'Erledigt' && !task.completed) return false;

    if (searchQuery.trim() !== '') {
      const query = searchQuery.toLowerCase();
      const matchTitle = task.title.toLowerCase().includes(query);
      const matchPriority = task.priority.toLowerCase().includes(query);
      const matchDueDate = task.dueDate ? task.dueDate.includes(query) : false;
      return matchTitle || matchPriority || matchDueDate;
    }
    return true;
  });

  const getUnitLabel = (uVal) => {
    const found = UNITS.find((u) => u.value === uVal);
    return found ? found.label : 'Stunden';
  };

  const getRecurrenceLabel = (rVal) => {
    const found = RECURRENCE_OPTIONS.find((r) => r.value === rVal);
    return found ? found.label : 'Einmalig';
  };

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOf6Days = startOfToday + 6 * 24 * 60 * 60 * 1000;

  const tasksInNext6Days = tasks.filter((t) => {
    if (!t.dueDate) return false;
    const taskDateObj = parseDateTime(t.dueDate, t.dueTime || '00:00');
    if (!taskDateObj) return false;
    const taskTime = taskDateObj.getTime();
    return taskTime >= startOfToday && taskTime <= endOf6Days;
  });

  const total6DaysCount = tasksInNext6Days.length;
  const completed6DaysCount = tasksInNext6Days.filter((t) => t.completed).length;
  const progressPercent6Days =
    total6DaysCount > 0 ? Math.round((completed6DaysCount / total6DaysCount) * 100) : 0;

  const getProgressBarColor = (percent) => {
    if (percent <= 33) return '#EF4444';
    if (percent <= 66) return '#F59E0B';
    return '#10B981';
  };

  const color6Days = getProgressBarColor(progressPercent6Days);

  const openTasksCountByDate = useMemo(() => {
    const counts = {};
    tasks.forEach((t) => {
      if (!t.completed && t.dueDate) {
        counts[t.dueDate] = (counts[t.dueDate] || 0) + 1;
      }
    });
    return counts;
  }, [tasks]);

  const calendarDays = useMemo(() => {
    const days = [];
    const endTimestamp = new Date(calendarEndYear, 11, 31).getTime();
    let dayCounter = 0;
    let lastMonth = -1;
    let lastYear = -1;

    while (true) {
      const timeVal = startOfToday + dayCounter * 24 * 60 * 60 * 1000;
      if (timeVal > endTimestamp) break;
      const dObj = new Date(timeVal);
      const currentMonth = dObj.getMonth();
      const currentYearVal = dObj.getFullYear();

      if (currentMonth !== lastMonth || currentYearVal !== lastYear) {
        const monthName = dObj.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
        days.push({
          isHeader: true,
          id: `header_${currentYearVal}_${currentMonth}`,
          label: monthName.toUpperCase(),
        });
        lastMonth = currentMonth;
        lastYear = currentYearVal;
      }

      const dayStr = String(dObj.getDate()).padStart(2, '0');
      const monthStr = String(currentMonth + 1).padStart(2, '0');
      const yearStr = currentYearVal;
      const formatted = `${dayStr}.${monthStr}.${yearStr}`;
      const weekdayName = dObj.toLocaleDateString('de-DE', { weekday: 'short' });
      
      const holidays = getHessenHolidays(yearStr);
      const holidayName = holidays[formatted] || null;

      days.push({
        isHeader: false,
        formatted,
        label: `${weekdayName}, ${dayStr}.${monthStr}.`,
        holidayName,
        openTasksCount: openTasksCountByDate[formatted] || 0,
      });

      dayCounter++;
    }
    return days;
  }, [calendarEndYear, startOfToday, openTasksCountByDate]);

  const unsupervisedCalendarDays = useMemo(() => {
    return checkForMinorSupervisionIssues(calendarData);
  }, [calendarData, calendarPersons]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

      <View style={styles.header}>
        <View>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Task-Kalender</Text>
          <Text style={[styles.headerSubtitle, { color: theme.textMuted }]}>
            {tasks.filter((t) => !t.completed).length} Aufgaben offen
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.iconButton, { backgroundColor: theme.cardBg, borderColor: theme.border }]}
          onPress={() => setSettingsModalVisible(true)}
        >
          <Text style={{ fontSize: 18 }}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {mainTab !== 'Kalender' && (
        <View style={[styles.highlightProgressCard, { backgroundColor: theme.cardBg, borderColor: theme.accent }]}>
          <View style={styles.progressCardHeader}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <View style={styles.titleRow}>
                <Text style={{ fontSize: 16, marginRight: 6 }}>📈</Text>
                <Text style={[styles.progressCardTitle, { color: theme.text }]}>
                  Nächste 6 Tage
                </Text>
              </View>
              <View style={[styles.statusBadgeContainer, { backgroundColor: isDarkMode ? '#334155' : '#EEF2FF' }]}>
                <Text style={[styles.statusBadgeText, { color: theme.accent }]}>
                  🎯 <Text style={{ fontWeight: '800' }}>{completed6DaysCount}</Text> von <Text style={{ fontWeight: '800' }}>{total6DaysCount}</Text> Aufgaben erledigt
                </Text>
              </View>
            </View>

            <View style={[styles.percentCircleContainer, { borderColor: color6Days }]}>
              <Text style={[styles.progressPercentLarge, { color: color6Days }]}>
                {progressPercent6Days}%
              </Text>
            </View>
          </View>

          <View style={[styles.progressBarTrackXLarge, { backgroundColor: isDarkMode ? '#1E293B' : '#E2E8F0' }]}>
            <View
              style={[
                styles.progressBarFillXLarge,
                { backgroundColor: color6Days, width: `${progressPercent6Days}%` },
              ]}
            />
          </View>
        </View>
      )}

      <View style={styles.mainTabContainer}>
        {[
          { key: 'Neu', label: '➕ Neu' },
          { key: 'Offen', label: `⏳ Offen (${tasks.filter(t => !t.completed).length})` },
          { key: 'Erledigt', label: `✅ Erledigt (${tasks.filter(t => t.completed).length})` },
          { key: 'Kalender', label: '📅 Kalender' },
        ].map((tab) => {
          const isActive = mainTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.mainTabButton,
                {
                  backgroundColor: isActive ? theme.accent : theme.cardBg,
                  borderColor: theme.border,
                },
              ]}
              onPress={() => setMainTab(tab.key)}
            >
              <Text
                style={{
                  color: isActive ? '#FFF' : theme.textMuted,
                  fontWeight: isActive ? '700' : '500',
                  fontSize: 11,
                }}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {mainTab === 'Kalender' ? (
        <View style={{ flex: 1, paddingHorizontal: 16 }}>
          {unsupervisedCalendarDays.length > 0 && (
            <TouchableOpacity
              style={{ backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#EF4444', borderRadius: 10, padding: 8, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
              onPress={() => setAlarmModalVisible(true)}
            >
              <Text style={{ color: '#DC2626', fontSize: 11, fontWeight: '700', flex: 1 }}>
                ⚠️ Minderjährige ohne Aufsicht: {unsupervisedCalendarDays.length} Tag(e)
              </Text>
              <Text style={{ color: '#DC2626', fontSize: 11, fontWeight: 'bold' }}>Details ➔</Text>
            </TouchableOpacity>
          )}

          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8, alignItems: 'center' }}>
            <TextInput
              style={[styles.input, { flex: 1, color: theme.text, borderColor: theme.border, marginBottom: 0, fontSize: 11, borderWidth: 1, backgroundColor: theme.cardBg, paddingVertical: 6 }]}
              placeholder="Datum anspringen (TT.MM.JJJJ)"
              placeholderTextColor={theme.textMuted}
              keyboardType="numeric"
              maxLength={10}
              value={jumpDateInput}
              onChangeText={(text) => setJumpDateInput(formatDDMMYYYY(text))}
              onSubmitEditing={() => jumpToSpecificDate(jumpDateInput)}
              returnKeyType="done"
              underlineColorAndroid="transparent"
            />
            <TouchableOpacity
              style={[styles.smallAddButton, { backgroundColor: theme.accent, height: 32, paddingHorizontal: 10, width: 'auto' }]}
              onPress={() => jumpToSpecificDate(jumpDateInput)}
            >
              <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 11 }}>Los</Text>
            </TouchableOpacity>

            {calendarEndYear < 2050 && (
              <TouchableOpacity
                style={[styles.smallAddButton, { backgroundColor: theme.border, height: 32, paddingHorizontal: 8, width: 'auto' }]}
                onPress={() => setCalendarEndYear(Math.min(calendarEndYear + 5, 2050))}
              >
                <Text style={{ color: theme.text, fontWeight: 'bold', fontSize: 10 }}>+ Bis 2050 laden</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8, paddingHorizontal: 2, flexWrap: 'wrap', gap: 4 }}>
            {CALENDAR_TYPES.map((ct) => (
              <View key={ct.value} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ct.color }} />
                <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: '600' }}>{ct.label}</Text>
              </View>
            ))}
          </View>

          <View style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.cardBg }}>
            <View style={{ flexDirection: 'row', height: 44, borderBottomWidth: 2, borderBottomColor: theme.border, backgroundColor: isDarkMode ? '#1E293B' : '#F8FAFC', zIndex: 3 }}>
              <View style={{ width: 75, justifyContent: 'center', paddingLeft: 4, borderRightWidth: 2, borderRightColor: theme.border }}>
                <Text style={{ color: theme.text, fontWeight: '700', fontSize: 11 }}>Datum</Text>
              </View>
              <ScrollView
                ref={headerScrollRef}
                horizontal
                scrollEnabled={false}
                showsHorizontalScrollIndicator={false}
                style={{ flex: 1 }}
              >
                <View style={{ flexDirection: 'row' }}>
                  {calendarPersons.map((p) => (
                    <View key={p.name} style={{ width: 75, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, borderRightWidth: 1, borderRightColor: theme.border }}>
                      <Text style={{ color: theme.text, fontWeight: '700', fontSize: 10 }} numberOfLines={1}>
                        {p.name} {p.isMinor ? '👶' : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>

            <FlatList
              ref={verticalFlatListRef}
              data={calendarDays}
              keyExtractor={(item) => item.id || item.formatted}
              getItemLayout={(data, index) => ({ length: 48, offset: 48 * index, index })}
              initialNumToRender={20}
              maxToRenderPerBatch={20}
              windowSize={10}
              removeClippedSubviews={true}
              renderItem={({ item, index }) => {
                if (item.isHeader) {
                  return (
                    <View style={{ height: 36, backgroundColor: isDarkMode ? '#334155' : '#E2E8F0', justifyContent: 'center', paddingLeft: 10, borderBottomWidth: 2, borderBottomColor: theme.border }}>
                      <Text style={{ color: theme.text, fontWeight: '800', fontSize: 11, letterSpacing: 1 }}>
                        📅 {item.label}
                      </Text>
                    </View>
                  );
                }

                const dObj = item;
                const isUnsupervised = unsupervisedCalendarDays.includes(dObj.formatted);
                const taskCount = dObj.openTasksCount;

                return (
                  <View style={{ flexDirection: 'row', height: 48, borderBottomWidth: 1, borderBottomColor: theme.border, alignItems: 'center' }}>
                    <View style={{ width: 75, height: 48, justifyContent: 'center', borderRightWidth: 2, borderRightColor: theme.border, paddingLeft: 4, position: 'relative', backgroundColor: isUnsupervised ? (isDarkMode ? '#7F1D1D' : '#FEE2E2') : theme.cardBg }}>
                      <Text style={{ color: isUnsupervised ? '#EF4444' : theme.text, fontSize: 9, fontWeight: isUnsupervised ? '900' : '600' }} numberOfLines={1}>
                        {dObj.label}
                      </Text>
                      {dObj.holidayName ? (
                        <Text style={{ color: '#D97706', fontSize: 7, fontWeight: '700' }} numberOfLines={1}>
                          🎉 {dObj.holidayName}
                        </Text>
                      ) : null}
                      
                      {taskCount > 0 && (
                        <TouchableOpacity 
                          style={{ position: 'absolute', top: 4, right: 4, backgroundColor: '#EF4444', borderRadius: 8, paddingHorizontal: 4, paddingVertical: 1, minWidth: 14, alignItems: 'center', justifyContent: 'center' }}
                          onPress={() => handleTaskBadgePress(dObj.formatted)}
                        >
                          <Text style={{ color: '#FFF', fontSize: 7, fontWeight: 'bold' }}>{taskCount}</Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    <ScrollView
                      ref={(el) => (rowScrollRefs.current[index] = el)}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      scrollEventThrottle={16}
                      onScroll={(e) => {
                        handleHorizontalScroll(e.nativeEvent.contentOffset.x);
                      }}
                      style={{ flex: 1 }}
                    >
                      <View style={{ flexDirection: 'row' }}>
                        {calendarPersons.map((p) => {
                          const key = `${dObj.formatted}_${p.name}`;
                          let val = calendarData[key];

                          if (!val && p.isMinor && dObj.holidayName) {
                            val = 'free';
                          }

                          const matchedType = CALENDAR_TYPES.find((ct) => ct.value === val);
                          const cellBg = matchedType ? matchedType.color : (isDarkMode ? '#0F172A' : '#F8FAFC');
                          const cellText = matchedType ? matchedType.label : '-';

                          return (
                            <TouchableOpacity
                              key={p.name}
                              style={[
                                styles.calendarCell,
                                {
                                  backgroundColor: cellBg,
                                  borderColor: theme.border,
                                },
                              ]}
                              onPress={() => handleCellPress(dObj.formatted, p.name)}
                            >
                              <Text style={{ color: matchedType ? '#FFF' : theme.textMuted, fontSize: 10, fontWeight: '700' }} numberOfLines={1}>
                                {cellText}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </ScrollView>
                  </View>
                );
              }}
            />
          </View>
        </View>
      ) : mainTab === 'Neu' ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}>
          <View style={[styles.inputCard, { backgroundColor: theme.cardBg, borderColor: theme.border }]}>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.border, borderWidth: 1, backgroundColor: theme.cardBg }]}
              placeholder="Neue Aufgabe eingeben..."
              placeholderTextColor={theme.textMuted}
              value={textInput}
              onChangeText={setTextInput}
              returnKeyType="next"
              onSubmitEditing={() => dueDateInputRef.current?.focus()}
            />

            <View style={styles.dateTimeRow}>
              <TextInput
                ref={dueDateInputRef}
                style={[styles.dateInput, { color: theme.text, borderColor: theme.border, borderWidth: 1, backgroundColor: theme.cardBg }]}
                placeholder="Datum (DDMMJJJJ)"
                placeholderTextColor={theme.textMuted}
                keyboardType="numeric"
                maxLength={10}
                value={dueDateInput}
                onChangeText={handleDueDateChange}
                onBlur={handleDueDateBlur}
                underlineColorAndroid="transparent"
                returnKeyType="next"
                onSubmitEditing={() => dueTimeInputRef.current?.focus()}
              />

              <TextInput
                ref={dueTimeInputRef}
                style={[styles.timeInput, { color: theme.text, borderColor: theme.border, borderWidth: 1, backgroundColor: theme.cardBg }]}
                placeholder="HH:MM"
                placeholderTextColor={theme.textMuted}
                keyboardType="numeric"
                maxLength={5}
                value={dueTimeInput}
                onChangeText={handleDueTimeChange}
                onBlur={handleDueTimeBlur}
                underlineColorAndroid="transparent"
                returnKeyType="next"
                onSubmitEditing={() => reminderInputRef.current?.focus()}
              />
            </View>

            <Text style={[styles.sectionSubtitle, { color: theme.textMuted }]}>Unteraufgaben hinzufügen:</Text>
            
            {createdSubtasks.map((st) => (
              <View key={st.id} style={styles.editSubtaskRow}>
                <Text style={{ flex: 1, color: theme.text, fontSize: 12 }}>• {st.title}</Text>
                <TouchableOpacity onPress={() => removeCreatedSubtask(st.id)}>
                  <Text style={{ color: theme.priorityHigh, fontSize: 12 }}>❌</Text>
                </TouchableOpacity>
              </View>
            ))}

            <View style={styles.addSubtaskContainer}>
              <TextInput
                style={[
                  styles.input,
                  { flex: 1, color: theme.text, borderColor: theme.border, borderWidth: 1, backgroundColor: theme.cardBg, marginBottom: 0, fontSize: 12 },
                ]}
                placeholder="Eine Unteraufgabe hinzufügen..."
                placeholderTextColor={theme.textMuted}
                value={newSubtaskInputText}
                onChangeText={setNewSubtaskInputText}
                underlineColorAndroid="transparent"
              />
              <TouchableOpacity
                style={[styles.smallAddButton, { backgroundColor: theme.accent }]}
                onPress={addCreatedSubtask}
              >
                <Text style={{ color: '#FFF', fontWeight: 'bold' }}>+</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.optionsRow}>
              <View style={{ flex: 1, marginRight: 6 }}>
                <Text style={[styles.sectionSubtitle, { color: theme.textMuted }]}>Wiederholung:</Text>
                <View style={styles.badgeRowInline}>
                  {RECURRENCE_OPTIONS.map((r) => (
                    <TouchableOpacity
                      key={r.value}
                      style={[
                        styles.smallBadge,
                        {
                          backgroundColor: recurrence === r.value ? theme.accent : 'transparent',
                          borderColor: theme.border,
                        },
                      ]}
                      onPress={() => setRecurrence(r.value)}
                    >
                      <Text
                        style={{
                          color: recurrence === r.value ? '#FFF' : theme.textMuted,
                          fontSize: 10,
                          fontWeight: '600',
                        }}
                      >
                        {r.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            <Text style={[styles.sectionSubtitle, { color: theme.textMuted }]}>Erinnerung vorher:</Text>
            <View style={styles.reminderRow}>
              <TextInput
                ref={reminderInputRef}
                style={[styles.reminderInput, { color: theme.text, borderColor: theme.border, borderWidth: 1, backgroundColor: theme.cardBg }]}
                placeholder=""
                placeholderTextColor={theme.textMuted}
                keyboardType="numeric"
                value={reminderValue}
                onChangeText={setReminderValue}
                underlineColorAndroid="transparent"
              />

              <TouchableOpacity
                style={[styles.dropdownButton, { backgroundColor: theme.cardBg, borderColor: theme.border }]}
                onPress={() => setUnitDropdownVisible(true)}
              >
                <Text style={{ color: theme.text, fontSize: 14 }}>{getUnitLabel(reminderUnit)} ▾</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.row}>
              <Text style={[styles.label, { color: theme.textMuted }]}>Priorität:</Text>
              {['Niedrig', 'Mittel', 'Hoch'].map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.badge,
                    {
                      backgroundColor: priority === p ? theme.accent : 'transparent',
                      borderColor: theme.border,
                    },
                  ]}
                  onPress={() => setPriority(p)}
                >
                  <Text
                    style={{
                      color: priority === p ? '#FFF' : theme.textMuted,
                      fontSize: 12,
                      fontWeight: '600',
                    }}
                  >
                    {p}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: theme.accent }]}
              onPress={addTask}
            >
              <Text style={styles.addButtonText}>Aufgabe Hinzufügen</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      ) : (
        <>
          <View style={[styles.searchContainer, { backgroundColor: theme.cardBg, borderColor: theme.border }]}>
            <Text style={{ fontSize: 16, marginRight: 8 }}>🔍</Text>
            <TextInput
              style={[styles.searchInput, { color: theme.text }]}
              placeholder="Aufgabe, Frist oder Priorität suchen..."
              placeholderTextColor={theme.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearSearchButton}>
                <Text style={{ fontSize: 14, color: theme.textMuted }}>❌</Text>
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            data={filteredTasks}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContainer}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={{ color: theme.textMuted, fontSize: 16 }}>Keine Aufgaben in diesem Bereich gefunden.</Text>
              </View>
            }
            renderItem={({ item }) => {
              const priorityColor =
                item.priority === 'Hoch'
                  ? theme.priorityHigh
                  : item.priority === 'Mittel'
                  ? theme.priorityMed
                  : theme.priorityLow;

              return (
                <View
                  style={[
                    styles.taskCard,
                    { backgroundColor: theme.cardBg, borderColor: theme.border },
                  ]}
                >
                  <TouchableOpacity style={styles.checkbox} onPress={() => toggleTask(item.id)}>
                    <View
                      style={[
                        styles.checkboxInner,
                        {
                          borderColor: theme.accent,
                          backgroundColor: item.completed ? theme.accent : 'transparent',
                        },
                      ]}
                    >
                      {item.completed && <Text style={{ color: '#FFF', fontSize: 10 }}>✓</Text>}
                    </View>
                  </TouchableOpacity>

                  <View style={styles.taskContentContainer}>
                    <Text
                      style={[
                        styles.taskTitle,
                        { color: theme.text },
                        item.completed && styles.taskCompleted,
                      ]}
                    >
                      {item.title}
                    </Text>

                    <View style={styles.metaRowInline}>
                      <View style={styles.metaItem}>
                        <View style={[styles.priorityIndicator, { backgroundColor: priorityColor }]} />
                        <Text style={[styles.taskMetaText, { color: theme.textMuted }]}>
                          {item.priority}
                        </Text>
                      </View>

                      {item.dueDate ? (
                        <View style={styles.metaItem}>
                          <Text style={{ fontSize: 11 }}>📅</Text>
                          <Text style={[styles.taskMetaText, { color: theme.textMuted }]}>
                            {item.dueDate} {item.dueTime ? `uhr ${item.dueTime}` : ''}
                          </Text>
                        </View>
                      ) : null}

                      {item.recurrence && item.recurrence !== 'none' ? (
                        <View style={styles.metaItem}>
                          <Text style={{ fontSize: 11 }}>🔁</Text>
                          <Text style={[styles.taskMetaText, { color: theme.textMuted }]}>
                            {getRecurrenceLabel(item.recurrence)}
                          </Text>
                        </View>
                      ) : null}

                      {item.dueDate && item.reminderValue ? (
                        <View style={styles.metaItem}>
                          <Text style={{ fontSize: 11 }}>🔔</Text>
                          <Text style={[styles.taskMetaText, { color: theme.textMuted }]}>
                            {item.reminderValue} {getUnitLabel(item.reminderUnit)} vorher
                          </Text>
                        </View>
                      ) : null}

                      {item.completed && item.completedAt ? (
                        <View style={styles.metaItem}>
                          <Text style={{ fontSize: 11 }}>✓</Text>
                          <Text style={[styles.completedDateText, { color: theme.priorityLow }]}>
                            Erledigt: {item.completedAt}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {item.subtasks && item.subtasks.length > 0 && (
                      <View style={[styles.subtasksBox, { backgroundColor: isDarkMode ? '#0F172A' : '#F1F5F9', borderColor: theme.border }]}>
                        <Text style={[styles.subtaskHeaderTitle, { color: theme.textMuted }]}>
                          Unteraufgaben ({item.subtasks.filter(s => s.completed).length}/{item.subtasks.length}):
                        </Text>
                        {item.subtasks.map((st) => (
                          <TouchableOpacity
                            key={st.id}
                            style={styles.subtaskRow}
                            onPress={() => toggleSubtask(item.id, st.id)}
                          >
                            <View
                              style={[
                                styles.subtaskCheckbox,
                                {
                                  borderColor: theme.accent,
                                  backgroundColor: st.completed ? theme.accent : 'transparent',
                                },
                              ]}
                            >
                              {st.completed && <Text style={{ color: '#FFF', fontSize: 8 }}>✓</Text>}
                            </View>
                            <Text
                              style={[
                                styles.subtaskTitle,
                                { color: theme.text },
                                st.completed && styles.taskCompleted,
                              ]}
                            >
                              {st.title}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>

                  <View style={styles.taskActionsContainer}>
                    <TouchableOpacity onPress={() => startEditTask(item)} style={styles.actionButton}>
                      <Text style={{ fontSize: 15 }}>✏️</Text>
                    </TouchableOpacity>

                    <TouchableOpacity onPress={() => deleteTask(item.id)} style={styles.actionButton}>
                      <Text style={{ fontSize: 15 }}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
          />
        </>
      )}

      {/* Alarm Modal */}
      <Modal visible={alarmModalVisible} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBg, borderColor: theme.border, maxHeight: '70%' }]}>
            <Text style={[styles.modalTitle, { color: '#EF4444', fontSize: 18 }]}>
              ⚠️ Aufsichtspflicht-Alarm
            </Text>
            <Text style={{ color: theme.textMuted, fontSize: 12, marginBottom: 12 }}>
              Folgende Tage haben minderjährige Personen frei (oder Ferien/Feiertag), aber kein Erwachsener hat frei oder Urlaub. Tippe auf einen Tag, um dorthin zu springen:
            </Text>

            <ScrollView style={{ maxHeight: 250, marginBottom: 15 }}>
              {unsupervisedCalendarDays.map((dStr) => (
                <TouchableOpacity
                  key={dStr}
                  style={{ backgroundColor: isDarkMode ? '#334155' : '#FEE2E2', padding: 10, borderRadius: 8, marginBottom: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                  onPress={() => {
                    setAlarmModalVisible(false);
                    setMainTab('Kalender');
                    jumpToSpecificDate(dStr);
                  }}
                >
                  <Text style={{ color: '#EF4444', fontWeight: 'bold', fontSize: 13 }}>📅 {dStr}</Text>
                  <Text style={{ color: theme.text, fontSize: 11 }}>Zum Tag springen ➔</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: theme.accent }]}
              onPress={() => setAlarmModalVisible(false)}
            >
              <Text style={{ color: '#FFF', fontWeight: 'bold' }}>Schließen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Status Picker Modal */}
      <Modal visible={statusPickerVisible} transparent={true} animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setStatusPickerVisible(false)}>
          <View style={[styles.dropdownContent, { backgroundColor: theme.cardBg, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text, fontSize: 16, marginBottom: 12 }]}>
              Status wählen {selectedCellTarget ? `(${selectedCellTarget.personName})` : ''}
              {selectedCellTarget?.isMinor ? ' 👶' : ''}
            </Text>

            {selectedCellTarget?.isHoliday && (
              <View style={{ backgroundColor: '#FEF3C7', padding: 6, borderRadius: 6, marginBottom: 10 }}>
                <Text style={{ color: '#D97706', fontSize: 11, fontWeight: '700' }}>🎉 An diesem Tag ist gesetzlicher Feiertag (Hessen).</Text>
              </View>
            )}

            {CALENDAR_TYPES.map((ct) => {
              const isDisabled = selectedCellTarget?.isMinor && ct.value === 'work';
              return (
                <TouchableOpacity
                  key={ct.value}
                  style={[
                    styles.dropdownItem,
                    { borderBottomColor: theme.border, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: isDisabled ? 0.4 : 1 },
                  ]}
                  disabled={isDisabled}
                  onPress={() => setCalendarStatusForSelectedCell(ct.value)}
                >
                  <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: ct.color }} />
                  <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>
                    {ct.label} {isDisabled ? '(Für Minderjährige gesperrt)' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[styles.dropdownItem, { borderBottomWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }]}
              onPress={() => setCalendarStatusForSelectedCell(undefined)}
            >
              <Text style={{ fontSize: 14 }}>🗑️</Text>
              <Text style={{ color: '#EF4444', fontSize: 15, fontWeight: '600' }}>Eintrag löschen / Leer</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={unitDropdownVisible} transparent={true} animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setUnitDropdownVisible(false)}>
          <View style={[styles.dropdownContent, { backgroundColor: theme.cardBg, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text, fontSize: 16, marginBottom: 10 }]}>Einheit wählen</Text>
            {UNITS.map((u) => (
              <TouchableOpacity
                key={u.value}
                style={[styles.dropdownItem, { borderBottomColor: theme.border }]}
                onPress={() => {
                  setReminderUnit(u.value);
                  setUnitDropdownVisible(false);
                }}
              >
                <Text style={{ color: theme.text, fontSize: 15 }}>{u.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={editUnitDropdownVisible} transparent={true} animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setEditUnitDropdownVisible(false)}>
          <View style={[styles.dropdownContent, { backgroundColor: theme.cardBg, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text, fontSize: 16, marginBottom: 10 }]}>Einheit wählen</Text>
            {UNITS.map((u) => (
              <TouchableOpacity
                key={u.value}
                style={[styles.dropdownItem, { borderBottomColor: theme.border }]}
                onPress={() => {
                  setEditReminderUnit(u.value);
                  setEditUnitDropdownVisible(false);
                }}
              >
                <Text style={{ color: theme.text, fontSize: 15 }}>{u.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={editModalVisible} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBg }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Aufgabe Bearbeiten</Text>

            <ScrollView contentContainerStyle={{ paddingBottom: 10 }}>
              <TextInput
                style={[styles.input, { color: theme.text, borderColor: theme.border, borderWidth: 1, backgroundColor: theme.cardBg }]}
                value={editText}
                onChangeText={setEditText}
                placeholder="Aufgabenbeschreibung"
                placeholderTextColor={theme.textMuted}
              />

              <View style={styles.dateTimeRow}>
                <TextInput
                  ref={editDueDateInputRef}
                  style={[styles.dateInput, { color: theme.text, borderColor: theme.border, borderWidth: 1, backgroundColor: theme.cardBg }]}
                  value={editDueDateInput}
                  onChangeText={handleEditDueDateChange}
                  onBlur={handleEditDueDateBlur}
                  placeholder="Datum (DDMMJJJJ)"
                  placeholderTextColor={theme.textMuted}
                  keyboardType="numeric"
                  maxLength={10}
                  underlineColorAndroid="transparent"
                />

                <TextInput
                  ref={editDueTimeInputRef}
                  style={[styles.timeInput, { color: theme.text, borderColor: theme.border, borderWidth: 1, backgroundColor: theme.cardBg }]}
                  value={editDueTimeInput}
                  onChangeText={handleEditDueTimeChange}
                  onBlur={handleEditDueTimeBlur}
                  placeholder="HH:MM"
                  placeholderTextColor={theme.textMuted}
                  keyboardType="numeric"
                  maxLength={5}
                  underlineColorAndroid="transparent"
                />
              </View>

              <Text style={[styles.sectionSubtitle, { color: theme.textMuted }]}>Wiederholung:</Text>
              <View style={styles.badgeRowInline}>
                {RECURRENCE_OPTIONS.map((r) => (
                  <TouchableOpacity
                    key={r.value}
                    style={[
                      styles.smallBadge,
                      {
                        backgroundColor: editRecurrence === r.value ? theme.accent : 'transparent',
                        borderColor: theme.border,
                      },
                    ]}
                    onPress={() => setEditRecurrence(r.value)}
                  >
                    <Text
                      style={{
                        color: editRecurrence === r.value ? '#FFF' : theme.textMuted,
                        fontSize: 11,
                        fontWeight: '600',
                      }}
                    >
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.sectionSubtitle, { color: theme.textMuted, marginTop: 10 }]}>
                Unteraufgaben verwalten:
              </Text>
              {editSubtasks.map((st) => (
                <View key={st.id} style={styles.editSubtaskRow}>
                  <Text style={{ flex: 1, color: theme.text, fontSize: 12 }}>• {st.title}</Text>
                  <TouchableOpacity onPress={() => removeEditSubtask(st.id)}>
                    <Text style={{ color: theme.priorityHigh, fontSize: 12 }}>❌</Text>
                  </TouchableOpacity>
                </View>
              ))}

              <View style={styles.addSubtaskContainer}>
                <TextInput
                  style={[
                    styles.input,
                    { flex: 1, color: theme.text, borderColor: theme.border, borderWidth: 1, backgroundColor: theme.cardBg, marginBottom: 0, fontSize: 12 },
                  ]}
                  placeholder="Neue Unteraufgabe..."
                  placeholderTextColor={theme.textMuted}
                  value={newSubtaskText}
                  onChangeText={setNewSubtaskText}
                  underlineColorAndroid="transparent"
                />
                <TouchableOpacity
                  style={[styles.smallAddButton, { backgroundColor: theme.accent }]}
                  onPress={addEditSubtask}
                >
                  <Text style={{ color: '#FFF', fontWeight: 'bold' }}>+</Text>
                </TouchableOpacity>
              </View>

              <Text style={[styles.sectionSubtitle, { color: theme.textMuted, marginTop: 10 }]}>Erinnerung vorher:</Text>
              <View style={styles.reminderRow}>
                <TextInput
                  style={[styles.reminderInput, { color: theme.text, borderColor: theme.border, borderWidth: 1, backgroundColor: theme.cardBg }]}
                  value={editReminderValue}
                  onChangeText={setEditReminderValue}
                  placeholder=""
                  placeholderTextColor={theme.textMuted}
                  keyboardType="numeric"
                  underlineColorAndroid="transparent"
                />

                <TouchableOpacity
                  style={[styles.dropdownButton, { backgroundColor: theme.cardBg, borderColor: theme.border, flex: 1 }]}
                  onPress={() => setEditUnitDropdownVisible(true)}
                >
                  <Text style={{ color: theme.text, fontSize: 14 }}>{getUnitLabel(editReminderUnit)} ▾</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.row}>
                <Text style={[styles.label, { color: theme.textMuted }]}>Priorität:</Text>
                {['Niedrig', 'Mittel', 'Hoch'].map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[
                      styles.badge,
                      {
                        backgroundColor: editPriority === p ? theme.accent : 'transparent',
                        borderColor: theme.border,
                      },
                    ]}
                    onPress={() => setEditPriority(p)}
                  >
                    <Text
                      style={{
                        color: editPriority === p ? '#FFF' : theme.textMuted,
                        fontSize: 12,
                        fontWeight: '600',
                      }}
                    >
                      {p}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: theme.accent, marginTop: 10 }]}
              onPress={saveEditedTask}
            >
              <Text style={styles.modalButtonText}>Speichern</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: theme.border }]}
              onPress={() => setEditModalVisible(false)}
            >
              <Text style={{ color: theme.text, fontWeight: 'bold' }}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Settings & Info Modal mit strukturierten Untertabs */}
      <Modal visible={settingsModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBg, maxHeight: '88%' }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Einstellungen & Info</Text>

            {/* Untertabs für die Einstellungen */}
            <View style={styles.settingsTabContainer}>
              {[
                { key: 'personen', label: '👥 Personen' },
                { key: 'serien', label: '📅 Serien' },
                { key: 'allgemein', label: '⚙️ Allgemein' },
              ].map((tab) => {
                const isActive = settingsTab === tab.key;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    style={[
                      styles.settingsTabButton,
                      {
                        backgroundColor: isActive ? theme.accent : (isDarkMode ? '#334155' : '#E2E8F0'),
                        borderColor: theme.border,
                      },
                    ]}
                    onPress={() => setSettingsTab(tab.key)}
                  >
                    <Text
                      style={{
                        color: isActive ? '#FFF' : theme.textMuted,
                        fontWeight: isActive ? '700' : '500',
                        fontSize: 11,
                      }}
                      numberOfLines={1}
                    >
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 15 }} showsVerticalScrollIndicator={false}>
              {settingsTab === 'personen' && (
                <View>
                  <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>KALENDER - PERSONEN VERWALTEN</Text>
                  
                  <View style={{ gap: 6, marginBottom: 10 }}>
                    {calendarPersons.map((p) => (
                      <View key={p.name} style={[styles.personEditRow, { backgroundColor: isDarkMode ? '#334155' : '#EEF2FF', borderColor: theme.border }]}>
                        {editingPersonName === p.name ? (
                          <View style={{ flexDirection: 'column', gap: 6 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <TextInput
                                style={[styles.input, { flex: 1, color: theme.text, marginBottom: 0, paddingVertical: 4, fontSize: 12, borderWidth: 0, borderBottomWidth: 0, backgroundColor: 'transparent' }]}
                                value={editPersonInputText}
                                onChangeText={setEditPersonInputText}
                                underlineColorAndroid="transparent"
                                selectionColor={theme.accent}
                                autoFocus
                              />
                              <TouchableOpacity onPress={saveRenamePerson} style={[styles.smallAddButton, { backgroundColor: theme.accent, height: 32, width: 32 }]}>
                                <Text style={{ color: '#FFF', fontSize: 12, fontWeight: 'bold' }}>✓</Text>
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => setEditingPersonName(null)} style={[styles.smallAddButton, { backgroundColor: theme.border, height: 32, width: 32 }]}>
                                <Text style={{ color: theme.text, fontSize: 12 }}>✕</Text>
                              </TouchableOpacity>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 4 }}>
                              <Text style={{ color: theme.textMuted, fontSize: 11 }}>Ist Minderjährig:</Text>
                              <Switch
                                value={editPersonIsMinor}
                                onValueChange={setEditPersonIsMinor}
                                trackColor={{ false: '#767577', true: theme.accent }}
                              />
                            </View>
                          </View>
                        ) : (
                          <View style={{ flexDirection: 'row', flex: 1, alignItems: 'center', justifyContent: 'space-between' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>{p.name}</Text>
                              {p.isMinor && (
                                <View style={{ backgroundColor: '#FEF3C7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                                  <Text style={{ color: '#D97706', fontSize: 9, fontWeight: '700' }}>Minderjährig</Text>
                                </View>
                              )}
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <TouchableOpacity onPress={() => startRenamePerson(p)}>
                                <Text style={{ fontSize: 14 }}>✏️</Text>
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => removeCalendarPerson(p.name)}>
                                <Text style={{ color: '#EF4444', fontSize: 14, fontWeight: 'bold' }}>✕</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>

                  <View style={{ backgroundColor: isDarkMode ? '#1E293B' : '#F8FAFC', padding: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.border, gap: 8 }}>
                    <TextInput
                      style={[styles.input, { color: theme.text, borderColor: theme.border, borderWidth: 1, backgroundColor: theme.cardBg, marginBottom: 0, fontSize: 12, paddingVertical: 6, paddingHorizontal: 10 }]}
                      placeholder="Neue Person hinzufügen..."
                      placeholderTextColor={theme.textMuted}
                      value={newPersonName}
                      onChangeText={setNewPersonName}
                      underlineColorAndroid="transparent"
                      selectionColor={theme.accent}
                    />
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}>
                      <Text style={{ color: theme.textMuted, fontSize: 12 }}>Als Minderjährig markieren</Text>
                      <Switch
                        value={newPersonIsMinor}
                        onValueChange={setNewPersonIsMinor}
                        trackColor={{ false: '#767577', true: theme.accent }}
                      />
                    </View>
                    <TouchableOpacity
                      style={[styles.modalButton, { backgroundColor: theme.accent, marginTop: 4, marginBottom: 0, paddingVertical: 8 }]}
                      onPress={addCalendarPerson}
                    >
                      <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 12 }}>+ Person speichern</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {settingsTab === 'serien' && (
                <View>
                  <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>KALENDER - SERIENEINTRÄGE</Text>
                  <Text style={{ color: theme.textMuted, fontSize: 12, marginBottom: 8 }}>
                    Generiere automatisch Schichten für einen Zeitraum:
                  </Text>

                  <View style={{ gap: 8 }}>
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                      {calendarPersons.map((p) => (
                        <TouchableOpacity
                          key={p.name}
                          style={[
                            styles.smallBadge,
                            {
                              backgroundColor: (seriesPerson || calendarPersons[0].name) === p.name ? theme.accent : 'transparent',
                              borderColor: theme.border,
                              paddingVertical: 6,
                              paddingHorizontal: 10,
                            },
                          ]}
                          onPress={() => setSeriesPerson(p.name)}
                        >
                          <Text style={{ color: (seriesPerson || calendarPersons[0].name) === p.name ? '#FFF' : theme.textMuted, fontSize: 11, fontWeight: '600' }}>
                            {p.name} {p.isMinor ? '👶' : ''}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TextInput
                        style={[styles.input, { flex: 1, color: theme.text, borderColor: theme.border, borderWidth: 1, backgroundColor: theme.cardBg, marginBottom: 0, fontSize: 11, paddingVertical: 6, paddingHorizontal: 10 }]}
                        placeholder="Start (TT.MM.JJJJ)"
                        placeholderTextColor={theme.textMuted}
                        keyboardType="numeric"
                        maxLength={10}
                        value={seriesStartDate}
                        onChangeText={handleSeriesStartDateChange}
                        underlineColorAndroid="transparent"
                      />
                      <TextInput
                        ref={seriesEndDateInputRef}
                        style={[styles.input, { flex: 1, color: theme.text, borderColor: theme.border, borderWidth: 1, backgroundColor: theme.cardBg, marginBottom: 0, fontSize: 11, paddingVertical: 6, paddingHorizontal: 10 }]}
                        placeholder="Ende (TT.MM.JJJJ)"
                        placeholderTextColor={theme.textMuted}
                        keyboardType="numeric"
                        maxLength={10}
                        value={seriesEndDate}
                        onChangeText={handleSeriesEndDateChange}
                        underlineColorAndroid="transparent"
                      />
                    </View>

                    <View style={{ gap: 8, backgroundColor: isDarkMode ? '#1E293B' : '#F8FAFC', padding: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.border }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <TextInput
                          style={[styles.input, { width: 45, color: theme.text, borderBottomWidth: 0, borderWidth: 0, marginBottom: 0, fontSize: 12, textAlign: 'center', backgroundColor: isDarkMode ? '#334155' : '#E2E8F0' }]}
                          keyboardType="numeric"
                          value={seriesWorkDays}
                          onChangeText={setSeriesWorkDays}
                          underlineColorAndroid="transparent"
                        />
                        <Text style={{ color: theme.textMuted, fontSize: 12, fontWeight: '600' }}>Tage:</Text>
                      </View>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                        {CALENDAR_TYPES.map((ct) => (
                          <TouchableOpacity
                            key={ct.value}
                            style={[
                              styles.smallBadge,
                              {
                                backgroundColor: seriesWorkType === ct.value ? ct.color : 'transparent',
                                borderColor: theme.border,
                                paddingVertical: 5,
                                paddingHorizontal: 8,
                              },
                            ]}
                            onPress={() => setSeriesWorkType(ct.value)}
                          >
                            <Text style={{ color: seriesWorkType === ct.value ? '#FFF' : theme.textMuted, fontSize: 11, fontWeight: '600' }}>
                              {ct.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <TextInput
                          style={[styles.input, { width: 45, color: theme.text, borderBottomWidth: 0, borderWidth: 0, marginBottom: 0, fontSize: 12, textAlign: 'center', backgroundColor: isDarkMode ? '#334155' : '#E2E8F0' }]}
                          keyboardType="numeric"
                          value={seriesFreeDays}
                          onChangeText={setSeriesFreeDays}
                          underlineColorAndroid="transparent"
                        />
                        <Text style={{ color: theme.textMuted, fontSize: 12, fontWeight: '600' }}>Tage:</Text>
                      </View>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                        {CALENDAR_TYPES.map((ct) => (
                          <TouchableOpacity
                            key={ct.value}
                            style={[
                              styles.smallBadge,
                              {
                                backgroundColor: seriesFreeType === ct.value ? ct.color : 'transparent',
                                borderColor: theme.border,
                                paddingVertical: 5,
                                paddingHorizontal: 8,
                              },
                            ]}
                            onPress={() => setSeriesFreeType(ct.value)}
                          >
                            <Text style={{ color: seriesFreeType === ct.value ? '#FFF' : theme.textMuted, fontSize: 11, fontWeight: '600' }}>
                              {ct.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>

                    {/* Schriftfarbe des Buttons explizit auf Weiß (#FFF) gesetzt */}
                    <TouchableOpacity
                      style={[styles.modalButton, { backgroundColor: theme.accent, marginTop: 6, marginBottom: 5 }]}
                      onPress={generateCalendarSeries}
                    >
                      <Text style={[styles.modalButtonText, { color: '#FFF' }]}>⚡ Serie generieren</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {settingsTab === 'allgemein' && (
                <View>
                  <View style={styles.settingRow}>
                    <Text style={{ color: theme.text, fontSize: 16 }}>Dunkles Design</Text>
                    <Switch value={isDarkMode} onValueChange={toggleDarkMode} />
                  </View>

                  <View style={[styles.divider, { backgroundColor: theme.border }]} />

                  <TouchableOpacity
                    style={[styles.modalButton, { backgroundColor: theme.border, marginTop: 0 }]}
                    onPress={() => {
                      setSettingsModalVisible(false);
                      setManualModalVisible(true);
                    }}
                  >
                    <Text style={[styles.modalButtonText, { color: theme.text }]}>📖 Benutzerhandbuch & Info</Text>
                  </TouchableOpacity>

                  <View style={[styles.divider, { backgroundColor: theme.border }]} />

                  <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>DATEN-BACKUP</Text>

                  <TouchableOpacity
                    style={[
                      styles.modalButton,
                      { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.border },
                    ]}
                    onPress={exportBackup}
                  >
                    <Text style={[styles.modalButtonText, { color: theme.text }]}>
                      💾 Backup Exportieren (JSON)
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.modalButton,
                      { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.border },
                    ]}
                    onPress={importBackup}
                  >
                    <Text style={[styles.modalButtonText, { color: theme.text }]}>
                      📥 Backup Wiederherstellen
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>

            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: theme.border }]}
              onPress={() => setSettingsModalVisible(false)}
            >
              <Text style={{ color: theme.text, fontWeight: 'bold' }}>Schließen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={manualModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBg, maxHeight: '80%' }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Benutzerhandbuch (Task-Kalender)</Text>

            <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
              <Text style={[styles.manualHeading, { color: theme.accent }]}>1. Aufgaben & To-Dos verwalten</Text>
              <Text style={[styles.manualText, { color: theme.textMuted }]}>
                • Erstelle neue Aufgaben im Reiter „Neu“ mit Beschreibung, Datum, Uhrzeit, Priorität und Unteraufgaben.{'\n'}
                • Offene Aufgaben für die nächsten 6 Tage werden im Dashboard oben übersichtlich als Fortschritt angezeigt.{'\n'}
                • Erledigte Aufgaben wandern in den Erledigt-Bereich oder wiederholen sich automatisch bei entsprechender Rhythmus-Einstellung.
              </Text>

              <Text style={[styles.manualHeading, { color: theme.accent }]}>2. Kalender, Personen & Feiertage</Text>
              <Text style={[styles.manualText, { color: theme.textMuted }]}>
                • Verwalte Personen und markiere sie bei Bedarf als minderjährig (👶).{'\n'}
                • **Feiertage Hessen:** Gesetzliche Feiertage (inkl. beweglicher Feiertage) werden automatisch im Datumsfeld angezeigt.{'\n'}
                • **Aufgaben-Direktlink:** Ein Tippen auf das rote Aufgaben-Badge (Anzahl der offenen Fristen) im Kalender springt direkt in die Offen-Ansicht und filtert nach diesem Datum.{'\n'}
                • **Automatische Feiertags-Sicherung für Minderjährige:** Beim Generieren von Serieneinträgen werden gesetzliche Feiertage für minderjährige Personen automatisch geschützt und stets auf „zu Hause“ gesetzt.{'\n'}
                • **Automatische Statusvergabe:** An Feiertagen wird für Minderjährige automatisch der Status „zu Hause“ vergeben (sofern nicht manuell überschrieben).{'\n'}
                • **Status-Sperren:** Der Status „Arbeit“ ist für minderjährige Personen gesperrt.{'\n'}
                • **Kompakte Ansicht:** Die Spaltenbreiten (75px) sind für 3 Personen und das Datum optimiert, sodass alles ohne horizontales Scrollen auf Standard-Bildschirmen sichtbar ist.{'\n'}
                • **Perfektes horizontales Scrollen:** Alle Zeilen und der Header scrollen synchron und einheitlich.{'\n'}
                • **Datum direkt anspringen:** Nach Eingabe der 8 Zahlen im Datumsfeld kann direkt per Tastatur-Enter („Los“/„Done“) oder über den „Los“-Button zum Datum gesprungen werden.{'\n'}
                • **Chronologische Aufsichtspflicht-Alarme:** Die Liste im Alarm-Modal ist automatisch von den nächsten zu den am spätesten kommenden Tagen aufsteigend sortiert.{'\n'}
                • **Aufsichtspflicht-Alarm:** Warnt, wenn Minderjährige frei haben, aber kein Erwachsener frei oder Urlaub hat.
              </Text>

              <Text style={[styles.manualHeading, { color: theme.accent }]}>3. Serieneinträge & Backup</Text>
              <Text style={[styles.manualText, { color: theme.textMuted }]}>
                • Generiere Schichtserien über die Einstellungen und exportiere/importiere deine Daten jederzeit als JSON-Backup.
              </Text>

              <View style={[styles.divider, { backgroundColor: theme.border }]} />

              <Text style={[styles.manualHeading, { color: theme.accent }]}>Entwicklerinformation</Text>
              <Text style={[styles.manualText, { color: theme.text }]}>
                Entwickler: Özgür Cetin{'\n'}
                E-Mail: ozgur.cetin@web.de
              </Text>
            </ScrollView>

            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: theme.accent, marginTop: 10 }]}
              onPress={() => setManualModalVisible(false)}
            >
              <Text style={{ color: '#FFF', fontWeight: 'bold' }}>Verstanden</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 15,
    paddingBottom: 5,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 2,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  highlightProgressCard: {
    marginHorizontal: 20,
    marginTop: 10,
    marginBottom: 12,
    padding: 16,
    borderRadius: 18,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  progressCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressCardTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  statusBadgeContainer: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 13,
  },
  percentCircleContainer: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 3.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  progressPercentLarge: {
    fontSize: 16,
    fontWeight: '900',
  },
  progressBarTrackXLarge: {
    height: 16,
    borderRadius: 8,
    overflow: 'hidden',
  },
  progressBarFillXLarge: {
    height: '100%',
    borderRadius: 8,
  },
  mainTabContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 12,
    gap: 4,
  },
  mainTabButton: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsTabContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
    gap: 6,
  },
  settingsTabButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputCard: {
    padding: 15,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 5,
  },
  input: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    marginBottom: 8,
    borderWidth: 0,
    borderBottomWidth: 0,
  },
  dateTimeRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  dateInput: {
    flex: 2,
    borderWidth: 0,
    borderBottomWidth: 0,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    marginRight: 8,
  },
  timeInput: {
    flex: 1,
    borderWidth: 0,
    borderBottomWidth: 0,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 8,
    fontSize: 13,
    textAlign: 'center',
  },
  optionsRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  badgeRowInline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  smallBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  sectionSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  reminderInput: {
    width: 70,
    borderWidth: 0,
    borderBottomWidth: 0,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    marginRight: 8,
    textAlign: 'center',
  },
  dropdownButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    justifyContent: 'center',
  },
  dropdownContent: {
    width: '80%',
    maxWidth: 300,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    alignSelf: 'center',
    marginTop: 'auto',
    marginBottom: 'auto',
  },
  dropdownItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 2,
  },
  clearSearchButton: {
    padding: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    marginRight: 10,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 8,
  },
  addButton: {
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  listContainer: {
    paddingHorizontal: 20,
    paddingBottom: 25,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 30,
  },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  checkbox: {
    marginRight: 10,
    marginTop: 2,
  },
  checkboxInner: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  taskContentContainer: {
    flex: 1,
    marginRight: 6,
  },
  taskTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
    lineHeight: 18,
  },
  taskCompleted: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  metaRowInline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  priorityIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  taskMetaText: {
    fontSize: 11,
  },
  completedDateText: {
    fontSize: 11,
    fontWeight: '600',
  },
  subtasksBox: {
    marginTop: 6,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  subtaskHeaderTitle: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 3,
  },
  subtaskCheckbox: {
    width: 16,
    height: 16,
    borderRadius: 3,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    marginTop: 1,
  },
  subtaskTitle: {
    flex: 1,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 15,
  },
  editSubtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 3,
  },
  addSubtaskContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    marginBottom: 8,
  },
  smallAddButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  taskActionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionButton: {
    padding: 4,
  },
  personEditRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  calendarCell: {
    width: 75,
    height: 48,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '85%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  manualHeading: {
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 10,
    marginBottom: 4,
  },
  manualText: {
    fontSize: 13,
    lineHeight: 18,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  divider: {
    height: 1,
    marginVertical: 15,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 12,
  },
  modalButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  modalButtonText: {
    fontWeight: 'bold',
  },
  closeButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
});
