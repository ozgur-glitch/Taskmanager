import React, { useState, useEffect, useRef } from 'react';
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
  TASKS: '@taskmanager_tasks_v41',
  SETTINGS: '@taskmanager_settings_v41',
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
  if (year < 2000 || year > 2100) return false;

  const dateObj = new Date(year, month - 1, day);
  return (
    dateObj.getFullYear() === year &&
    dateObj.getMonth() === month - 1 &&
    dateObj.getDate() === day
  );
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
  const [subtasksInput, setSubtasksInput] = useState('');
  const [newSubtaskInputText, setNewSubtaskInputText] = useState('');
  const [createdSubtasks, setCreatedSubtasks] = useState([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [mainTab, setMainTab] = useState('Offen');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [manualModalVisible, setManualModalVisible] = useState(false);

  // Edit State
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

  useEffect(() => {
    loadData();
    setupNotifications();
  }, []);

  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

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

      if (storedTasks !== null) setTasks(JSON.parse(storedTasks));
      if (storedSettings !== null) {
        const settings = JSON.parse(storedSettings);
        setIsDarkMode(settings.isDarkMode ?? false);
      }
    } catch (e) {
      Alert.alert('Fehler', 'Daten konnten nicht geladen werden.');
    }
  };

  const saveTasks = async (newTasks) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(newTasks));
    } catch (e) {
      console.log('Fehler beim Speichern:', e);
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

    const commaSubtasks = subtasksInput
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((title, index) => ({ id: `${Date.now()}_comma_${index}`, title, completed: false }));

    const finalSubtasks = [...createdSubtasks, ...commaSubtasks];

    const newTask = {
      id: Date.now().toString(),
      title: textInput.trim(),
      priority: priority,
      dueDate: dueDateInput.length === 10 ? dueDateInput : null,
      dueTime: dueTimeInput.length === 5 ? dueTimeInput : null,
      reminderValue: reminderValue.trim(),
      reminderUnit: reminderUnit,
      recurrence: recurrence,
      subtasks: finalSubtasks,
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
    setSubtasksInput('');
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

  const getSortedTasks = () => {
    return [...tasks].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;

      const dateA = parseDateTime(a.dueDate, a.dueTime);
      const dateB = parseDateTime(b.dueDate, b.dueTime);

      if (dateA && !dateB) return -1;
      if (!dateA && dateB) return 1;
      if (!dateA && !dateB) return 0;

      return dateA - dateB;
    });
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
      const fileName = `TaskManager_Backup_${Date.now()}.json`;

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

  const filteredTasks = getSortedTasks().filter((task) => {
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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

      <View style={styles.header}>
        <View>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Task Manager</Text>
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

      <View style={styles.mainTabContainer}>
        {[
          { key: 'Neu', label: '➕ Neu' },
          { key: 'Offen', label: `⏳ Offen (${tasks.filter(t => !t.completed).length})` },
          { key: 'Erledigt', label: `✅ Erledigt (${tasks.filter(t => t.completed).length})` },
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
                  fontSize: 12,
                }}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {mainTab === 'Neu' ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}>
          <View style={[styles.inputCard, { backgroundColor: theme.cardBg, borderColor: theme.border }]}>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
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
                style={[styles.dateInput, { color: theme.text, borderColor: theme.border }]}
                placeholder="Datum (DDMMJJJJ)"
                placeholderTextColor={theme.textMuted}
                keyboardType="numeric"
                maxLength={10}
                value={dueDateInput}
                onChangeText={handleDueDateChange}
                onBlur={handleDueDateBlur}
                returnKeyType="next"
                onSubmitEditing={() => dueTimeInputRef.current?.focus()}
              />

              <TextInput
                ref={dueTimeInputRef}
                style={[styles.timeInput, { color: theme.text, borderColor: theme.border }]}
                placeholder="HH:MM"
                placeholderTextColor={theme.textMuted}
                keyboardType="numeric"
                maxLength={5}
                value={dueTimeInput}
                onChangeText={handleDueTimeChange}
                onBlur={handleDueTimeBlur}
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
                  { flex: 1, color: theme.text, borderColor: theme.border, marginBottom: 0, fontSize: 12 },
                ]}
                placeholder="Eine Unteraufgabe hinzufügen..."
                placeholderTextColor={theme.textMuted}
                value={newSubtaskInputText}
                onChangeText={setNewSubtaskInputText}
              />
              <TouchableOpacity
                style={[styles.smallAddButton, { backgroundColor: theme.accent }]}
                onPress={addCreatedSubtask}
              >
                <Text style={{ color: '#FFF', fontWeight: 'bold' }}>+</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.border, fontSize: 11, marginTop: 4 }]}
              placeholder="Oder Unteraufgaben kommagetrennt (e.g. Schritt 1, Schritt 2)"
              placeholderTextColor={theme.textMuted}
              value={subtasksInput}
              onChangeText={setSubtasksInput}
            />

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
                style={[styles.reminderInput, { color: theme.text, borderColor: theme.border }]}
                placeholder=""
                placeholderTextColor={theme.textMuted}
                keyboardType="numeric"
                value={reminderValue}
                onChangeText={setReminderValue}
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
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                value={editText}
                onChangeText={setEditText}
                placeholder="Aufgabenbeschreibung"
                placeholderTextColor={theme.textMuted}
              />

              <View style={styles.dateTimeRow}>
                <TextInput
                  ref={editDueDateInputRef}
                  style={[styles.dateInput, { color: theme.text, borderColor: theme.border }]}
                  value={editDueDateInput}
                  onChangeText={handleEditDueDateChange}
                  onBlur={handleEditDueDateBlur}
                  placeholder="Datum (DDMMJJJJ)"
                  placeholderTextColor={theme.textMuted}
                  keyboardType="numeric"
                  maxLength={10}
                />

                <TextInput
                  ref={editDueTimeInputRef}
                  style={[styles.timeInput, { color: theme.text, borderColor: theme.border }]}
                  value={editDueTimeInput}
                  onChangeText={handleEditDueTimeChange}
                  onBlur={handleEditDueTimeBlur}
                  placeholder="HH:MM"
                  placeholderTextColor={theme.textMuted}
                  keyboardType="numeric"
                  maxLength={5}
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
                    { flex: 1, color: theme.text, borderColor: theme.border, marginBottom: 0, fontSize: 12 },
                  ]}
                  placeholder="Neue Unteraufgabe..."
                  placeholderTextColor={theme.textMuted}
                  value={newSubtaskText}
                  onChangeText={setNewSubtaskText}
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
                  style={[styles.reminderInput, { color: theme.text, borderColor: theme.border }]}
                  value={editReminderValue}
                  onChangeText={setEditReminderValue}
                  placeholder=""
                  placeholderTextColor={theme.textMuted}
                  keyboardType="numeric"
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

      <Modal visible={settingsModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBg }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Einstellungen & Info</Text>

            <View style={styles.settingRow}>
              <Text style={{ color: theme.text, fontSize: 16 }}>Dunkles Design</Text>
              <Switch value={isDarkMode} onValueChange={toggleDarkMode} />
            </View>

            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: theme.border, marginTop: 5 }]}
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
              style={[styles.modalButton, { backgroundColor: theme.accent }]}
              onPress={exportBackup}
            >
              <Text style={styles.modalButtonText}>💾 Backup Exportieren (JSON)</Text>
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
            <Text style={[styles.modalTitle, { color: theme.text }]}>Benutzerhandbuch</Text>

            <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
              <Text style={[styles.manualHeading, { color: theme.accent }]}>1. Neue Aufgabe erstellen (Tab „Neu“)</Text>
              <Text style={[styles.manualText, { color: theme.textMuted }]}>
                • Wechsle in den Tab **„Neu“**, um eine neue Aufgabe einzugeben.{'\n'}
                • Gib Titel, Datum (DDMMJJJJ), Uhrzeit (HH:MM) und Erinnerung ein.{'\n'}
                • **Unteraufgaben:** Du kannst schon direkt beim Erstellen mit dem **+**-Button mehrere Unteraufgaben anlegen oder sie per Komma eingeben.{'\n'}
                • Tippe auf „Aufgabe Hinzufügen“ – die App speichert die Aufgabe und wechselt zur Liste **Offen**.
              </Text>

              <Text style={[styles.manualHeading, { color: theme.accent }]}>2. Fortschrittsanzeige (Nächste 6 Tage)</Text>
              <Text style={[styles.manualText, { color: theme.textMuted }]}>
                • Die hervorgehobene Karte zeigt dir auf einen Blick den Erledigungsstand für die nächsten 6 Tage.
              </Text>

              <Text style={[styles.manualHeading, { color: theme.accent }]}>3. Haupt-Tabs & Wiederholungen</Text>
              <Text style={[styles.manualText, { color: theme.textMuted }]}>
                • **Offen:** Zeigt alle aktuell ausstehenden Aufgaben.{'\n'}
                • **Erledigt:** Zeigt alle abgeschlossenen Aufgaben inklusive Erledigt-Datum.{'\n'}
                • **Wiederkehrende Aufgaben:** Beim Abhaken verbleibt der erledigte Eintrag unter Erledigt, während unter Offen automatisch der nächste Fälligkeitstermin erzeugt wird.
              </Text>

              <Text style={[styles.manualHeading, { color: theme.accent }]}>4. Backup & Daten</Text>
              <Text style={[styles.manualText, { color: theme.textMuted }]}>
                Über die Einstellungen kannst du jederzeit ein JSON-Backup deiner Daten erstellen oder wiederherstellen.
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
    gap: 8,
  },
  mainTabButton: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
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
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    marginBottom: 8,
  },
  dateTimeRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  dateInput: {
    flex: 2,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    marginRight: 8,
  },
  timeInput: {
    flex: 1,
    borderWidth: 1,
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
    borderWidth: 1,
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
    alignItems: 'center',
    marginVertical: 2,
  },
  subtaskCheckbox: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  subtaskTitle: {
    fontSize: 11,
    fontWeight: '500',
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
    color: '#FFF',
    fontWeight: 'bold',
  },
  closeButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
});
