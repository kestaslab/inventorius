import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar, NavigationTab } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { InventoryListView } from './components/InventoryListView';
import { DepartmentsRoomsView } from './components/DepartmentsRoomsView';
import { MovementsView } from './components/MovementsView';
import { AuditView } from './components/AuditView';
import { ReportsView } from './components/ReportsView';
import { LabelsQRView } from './components/LabelsQRView';
import { UsersManagementView } from './components/UsersManagementView';
import { SelfHostView } from './components/SelfHostView';
import { ItemModal } from './components/ItemModal';
import { ItemDetailModal } from './components/ItemDetailModal';
import { TransferModal } from './components/TransferModal';
import { WriteOffModal } from './components/WriteOffModal';
import { UserModal } from './components/UserModal';
import { LoginModal } from './components/LoginModal';
import { AccessDeniedView } from './components/AccessDeniedView';

import { 
  Department, 
  Room, 
  User, 
  InventoryItem, 
  MovementRecord, 
  WriteOffAct, 
  AuditSession,
  AuthSettings 
} from './types/inventory';
import { StorageService } from './utils/storage';

export default function App() {
  // Application Data States
  const [departments, setDepartments] = useState<Department[]>(() => StorageService.getDepartments());
  const [rooms, setRooms] = useState<Room[]>(() => StorageService.getRooms());
  const [users, setUsers] = useState<User[]>(() => StorageService.getUsers());
  const [items, setItems] = useState<InventoryItem[]>(() => StorageService.getItems());
  const [movements, setMovements] = useState<MovementRecord[]>(() => StorageService.getMovements());
  const [writeOffActs, setWriteOffActs] = useState<WriteOffAct[]>(() => StorageService.getWriteOffActs());
  const [auditSessions, setAuditSessions] = useState<AuditSession[]>(() => StorageService.getAuditSessions());
  const [activeUserId, setActiveUserId] = useState<string>(() => StorageService.getActiveUserId());
  const [authSettings, setAuthSettings] = useState<AuthSettings>(() => StorageService.getAuthSettings());

  // Cloudflare Access Gatekeeper State (Access Denied for students / unlisted users)
  const [deniedAccessEmail, setDeniedAccessEmail] = useState<string | null>(null);

  // Navigation State
  const [currentTab, setCurrentTab] = useState<NavigationTab>('dashboard');

  // Modals
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);

  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<InventoryItem | null>(null);

  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferTargetItem, setTransferTargetItem] = useState<InventoryItem | null>(null);

  const [isWriteOffModalOpen, setIsWriteOffModalOpen] = useState(false);
  const [writeOffTargetItem, setWriteOffTargetItem] = useState<InventoryItem | null>(null);

  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  const [labelsPreselectedIds, setLabelsPreselectedIds] = useState<string[]>([]);

  // Reload everything from storage (e.g. after JSON backup restore or reset)
  const refreshFromStorage = useCallback(() => {
    setDepartments(StorageService.getDepartments());
    setRooms(StorageService.getRooms());
    setUsers(StorageService.getUsers());
    setItems(StorageService.getItems());
    setMovements(StorageService.getMovements());
    setWriteOffActs(StorageService.getWriteOffActs());
    setAuditSessions(StorageService.getAuditSessions());
    setActiveUserId(StorageService.getActiveUserId());
    setAuthSettings(StorageService.getAuthSettings());
  }, []);

  const currentUser = users.find(u => u.id === activeUserId) || users[0];
  const activeAuditSession = auditSessions[0];

  // Active user switcher
  const handleChangeUser = (userId: string) => {
    setActiveUserId(userId);
    StorageService.setActiveUserId(userId);
  };

  // User Management Handlers
  const handleSaveUser = (userToSave: User) => {
    let updatedUsers: User[];
    const exists = users.some(u => u.id === userToSave.id);
    if (exists) {
      updatedUsers = users.map(u => (u.id === userToSave.id ? userToSave : u));
    } else {
      updatedUsers = [...users, userToSave];
    }
    setUsers(updatedUsers);
    StorageService.saveUsers(updatedUsers);
  };

  const handleDeleteUser = (userId: string) => {
    const updated = users.filter(u => u.id !== userId);
    setUsers(updated);
    StorageService.saveUsers(updated);
  };

  const handleUpdateAuthSettings = (newSettings: AuthSettings) => {
    setAuthSettings(newSettings);
    StorageService.saveAuthSettings(newSettings);
  };

  const handleLoginSuccess = (user: User) => {
    setActiveUserId(user.id);
    StorageService.setActiveUserId(user.id);
    const updated = users.map(u => 
      u.id === user.id ? { ...u, lastLoginAt: new Date().toISOString() } : u
    );
    setUsers(updated);
    StorageService.saveUsers(updated);
  };

  // Cloudflare Access Email Detection & Whitelist Verification
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlCfEmail = params.get('cf_email') || params.get('email');
    const storedSimEmail = sessionStorage.getItem('cf_simulated_email');
    const targetEmail = urlCfEmail || storedSimEmail;

    if (targetEmail) {
      const q = targetEmail.trim().toLowerCase();
      const matched = users.find(u => 
        u.email.toLowerCase() === q || 
        (u.allowedGmail && u.allowedGmail.toLowerCase() === q)
      );

      if (matched && matched.isActive !== false) {
        setActiveUserId(matched.id);
        StorageService.setActiveUserId(matched.id);
        setDeniedAccessEmail(null);
      } else {
        // Access Denied: not in staff registry (e.g. student!) or inactive
        setDeniedAccessEmail(targetEmail);
      }
    }
  }, [users]);

  // Batch Import Users (CSV)
  const handleBatchImportUsers = (newUsersList: User[]) => {
    const updatedUsers = [...users];
    newUsersList.forEach((newUser) => {
      const idx = updatedUsers.findIndex(
        (u) => u.email.toLowerCase() === newUser.email.toLowerCase()
      );
      if (idx !== -1) {
        updatedUsers[idx] = { ...updatedUsers[idx], ...newUser };
      } else {
        updatedUsers.push(newUser);
      }
    });
    setUsers(updatedUsers);
    StorageService.saveUsers(updatedUsers);
  };

  // Simulate Cloudflare Access Login / Test Screen
  const handleSimulateCloudflareLogin = (email: string) => {
    sessionStorage.setItem('cf_simulated_email', email);
    const q = email.trim().toLowerCase();
    const matched = users.find(
      (u) =>
        u.email.toLowerCase() === q ||
        (u.allowedGmail && u.allowedGmail.toLowerCase() === q)
    );

    if (matched && matched.isActive !== false) {
      setActiveUserId(matched.id);
      StorageService.setActiveUserId(matched.id);
      setDeniedAccessEmail(null);
    } else {
      setDeniedAccessEmail(email);
    }
  };

  // Add / Edit Item Handler
  const handleSaveItem = (itemToSave: InventoryItem) => {
    let updated: InventoryItem[];
    const exists = items.some(i => i.id === itemToSave.id);
    if (exists) {
      updated = items.map(i => (i.id === itemToSave.id ? itemToSave : i));
    } else {
      updated = [itemToSave, ...items];
    }
    setItems(updated);
    StorageService.saveItems(updated);
  };

  // Delete Item Handler
  const handleDeleteItem = (itemId: string) => {
    if (confirm('Ar tikrai norite pašalinti šį įrašą iš registro?')) {
      const updated = items.filter(i => i.id !== itemId);
      setItems(updated);
      StorageService.saveItems(updated);
    }
  };

  // Transfer Asset Handler
  const handleExecuteTransfer = (record: MovementRecord) => {
    // 1. Add movement to history
    const updatedMovements = [record, ...movements];
    setMovements(updatedMovements);
    StorageService.saveMovements(updatedMovements);

    // 2. Update item location and responsible person
    const updatedItems = items.map(i => {
      if (i.id === record.itemId) {
        return {
          ...i,
          departmentId: record.toDepartmentId,
          roomId: record.toRoomId,
          responsibleUserId: record.toUserId,
        };
      }
      return i;
    });
    setItems(updatedItems);
    StorageService.saveItems(updatedItems);
  };

  // Write-off Handler
  const handleConfirmWriteOff = (item: InventoryItem, reasonCategory: string, notes: string) => {
    // 1. Update item status to 'to_writeoff'
    const updatedItems = items.map(i => {
      if (i.id === item.id) {
        return {
          ...i,
          status: 'to_writeoff' as const,
          condition: 'poor' as const,
          notes: notes ? `${i.notes ? i.notes + ' | ' : ''}Defektas: ${notes}` : i.notes,
        };
      }
      return i;
    });
    setItems(updatedItems);
    StorageService.saveItems(updatedItems);

    // 2. Append to draft or create write-off act
    const currentYear = new Date().getFullYear();
    const actNumber = `NUR-${currentYear}-${Math.floor(10 + Math.random() * 90)}`;
    const newAct: WriteOffAct = {
      id: `act-${Date.now()}`,
      actNumber,
      date: new Date().toISOString().slice(0, 10),
      status: 'draft',
      committeeChair: 'Kęstutis Labanauskas (Ūkio dalies vedėjas)',
      committeeMembers: [
        'Dalia Vaitkutė (Vyriausioji buhalterė)',
        'Saulius Petrauskas (IT specialistas)',
      ],
      reasonCategory,
      notes,
      items: [
        {
          itemId: item.id,
          name: item.name,
          inventoryNumber: item.inventoryNumber,
          price: item.purchasePrice,
          residualPrice: item.residualValue ?? 0,
          reason: notes || reasonCategory,
        },
      ],
    };

    const updatedActs = [newAct, ...writeOffActs];
    setWriteOffActs(updatedActs);
    StorageService.saveWriteOffActs(updatedActs);
  };

  // Audit Session update
  const handleUpdateAuditSession = (updatedSession: AuditSession) => {
    const updated = auditSessions.map(s => (s.id === updatedSession.id ? updatedSession : s));
    setAuditSessions(updated);
    StorageService.saveAuditSessions(updated);
  };

  // Relocate Item during physical audit
  const handleRelocateItem = (itemId: string, newRoomId: string) => {
    const targetRoom = rooms.find(r => r.id === newRoomId);
    if (!targetRoom) return;

    const updatedItems = items.map(i => {
      if (i.id === itemId) {
        return {
          ...i,
          roomId: newRoomId,
          departmentId: targetRoom.departmentId,
          responsibleUserId: targetRoom.defaultResponsiblePersonId || i.responsibleUserId,
          lastAuditDate: new Date().toISOString().slice(0, 10),
        };
      }
      return i;
    });
    setItems(updatedItems);
    StorageService.saveItems(updatedItems);
  };

  // Save / Delete Department
  const handleSaveDepartment = (dept: Department) => {
    const exists = departments.some(d => d.id === dept.id);
    const updated = exists ? departments.map(d => (d.id === dept.id ? dept : d)) : [...departments, dept];
    setDepartments(updated);
    StorageService.saveDepartments(updated);
  };

  const handleDeleteDepartment = (deptId: string) => {
    const updated = departments.filter(d => d.id !== deptId);
    setDepartments(updated);
    StorageService.saveDepartments(updated);
  };

  // Save / Delete Room
  const handleSaveRoom = (room: Room) => {
    const exists = rooms.some(r => r.id === room.id);
    const updated = exists ? rooms.map(r => (r.id === room.id ? room : r)) : [...rooms, room];
    setRooms(updated);
    StorageService.saveRooms(updated);
  };

  const handleDeleteRoom = (roomId: string) => {
    const updated = rooms.filter(r => r.id !== roomId);
    setRooms(updated);
    StorageService.saveRooms(updated);
  };

  // Approve single item write-off -> Moves item to 'written_off' archive with chosen year
  const handleApproveItemWriteOff = (item: InventoryItem, approvalYear: number = new Date().getFullYear(), customActNumber?: string) => {
    const actNum = customActNumber || item.writeOffActNumber || `NUR-${approvalYear}-${Math.floor(10 + Math.random() * 90)}`;
    const today = new Date().toISOString().slice(0, 10);
    const updatedItems = items.map(i => {
      if (i.id === item.id) {
        return {
          ...i,
          status: 'written_off' as const,
          writtenOffDate: today,
          writtenOffYear: approvalYear,
          writeOffActNumber: actNum,
          writeOffReason: i.writeOffReason || item.notes || 'Komisijos patvirtintas nurašymas',
        };
      }
      return i;
    });
    setItems(updatedItems);
    StorageService.saveItems(updatedItems);

    // Update draft act if exists
    const updatedActs = writeOffActs.map(act => {
      if (act.items.some(actItem => actItem.itemId === item.id)) {
        return {
          ...act,
          status: 'approved' as const,
          actYear: approvalYear,
          approvedDate: today,
        };
      }
      return act;
    });
    setWriteOffActs(updatedActs);
    StorageService.saveWriteOffActs(updatedActs);
  };

  // Reject / Revert item pending write-off back to active
  const handleRejectWriteOff = (itemId: string) => {
    const updatedItems = items.map(i => {
      if (i.id === itemId) {
        return {
          ...i,
          status: 'active' as const,
        };
      }
      return i;
    });
    setItems(updatedItems);
    StorageService.saveItems(updatedItems);
  };

  // Restore archived written-off item back to active inventory
  const handleRestoreFromArchive = (itemId: string) => {
    if (confirm('Ar tikrai norite atkurti šį nurašytą turtą atgal į aktyvios apskaitos registrą?')) {
      const updatedItems = items.map(i => {
        if (i.id === itemId) {
          return {
            ...i,
            status: 'active' as const,
            condition: 'good' as const,
            notes: i.notes ? `${i.notes} (Atkurta iš ${i.writtenOffYear || ''} m. archyvo)` : 'Atkurta iš archyvo',
          };
        }
        return i;
      });
      setItems(updatedItems);
      StorageService.saveItems(updatedItems);
    }
  };

  // Permanently delete item
  const handlePermanentDelete = (itemId: string) => {
    if (confirm('DĖMESIO: Šis veiksmas visiškai pašalins materialiąją vertybę iš sistemos be galimybės atkurti. Ar tęsti?')) {
      const updated = items.filter(i => i.id !== itemId);
      setItems(updated);
      StorageService.saveItems(updated);
    }
  };

  // Approve entire write-off act from ReportsView
  const handleApproveWriteOffAct = (actId: string, approvalYear: number = new Date().getFullYear()) => {
    const targetAct = writeOffActs.find(a => a.id === actId);
    if (!targetAct) return;

    const today = new Date().toISOString().slice(0, 10);
    const updatedActs = writeOffActs.map(a => {
      if (a.id === actId) {
        return {
          ...a,
          status: 'approved' as const,
          actYear: approvalYear,
          approvedDate: today,
        };
      }
      return a;
    });
    setWriteOffActs(updatedActs);
    StorageService.saveWriteOffActs(updatedActs);

    const actItemIds = new Set(targetAct.items.map(it => it.itemId));
    const updatedItems = items.map(i => {
      if (actItemIds.has(i.id)) {
        return {
          ...i,
          status: 'written_off' as const,
          writtenOffDate: today,
          writtenOffYear: approvalYear,
          writeOffActNumber: targetAct.actNumber,
          writeOffReason: targetAct.reasonCategory,
          writeOffActId: targetAct.id,
        };
      }
      return i;
    });
    setItems(updatedItems);
    StorageService.saveItems(updatedItems);
  };

  // Save Write-off Act
  const handleSaveWriteOffAct = (act: WriteOffAct) => {
    const exists = writeOffActs.some(a => a.id === act.id);
    const updated = exists ? writeOffActs.map(a => (a.id === act.id ? act : a)) : [act, ...writeOffActs];
    setWriteOffActs(updated);
    StorageService.saveWriteOffActs(updated);
  };

  // Quick Print Specific Labels from Inventory List
  const handlePrintSpecificLabels = (itemIds: string[]) => {
    setLabelsPreselectedIds(itemIds);
    setCurrentTab('labels');
  };

  // Export to Excel / CSV
  const handleExportCSV = () => {
    const csv = StorageService.exportToCSV(items, departments, rooms, users);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tryskiu-mokykla-inventorius-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Access Denied Screen (for unauthorized students or external domain emails)
  if (deniedAccessEmail) {
    const adminUser = users.find((u) => u.role === 'admin') || users[0];
    return (
      <AccessDeniedView
        attemptedEmail={deniedAccessEmail}
        adminUser={adminUser}
        authSettings={authSettings}
        onAdminPinSuccess={() => {
          sessionStorage.removeItem('cf_simulated_email');
          setDeniedAccessEmail(null);
          if (adminUser) {
            setActiveUserId(adminUser.id);
            StorageService.setActiveUserId(adminUser.id);
          }
        }}
        onRetryDifferentEmail={() => {
          sessionStorage.removeItem('cf_simulated_email');
          if (window.location.search) {
            window.history.replaceState({}, '', window.location.pathname);
          }
          setDeniedAccessEmail(null);
          setIsLoginModalOpen(true);
        }}
      />
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 text-slate-900 font-sans">
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        currentUser={currentUser}
        allUsers={users}
        onChangeUser={handleChangeUser}
        itemsCount={items.length}
        onOpenLoginModal={() => setIsLoginModalOpen(true)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-slate-100">
        {/* Top Header */}
        <Header
          currentTab={currentTab}
          currentUser={currentUser}
          onOpenAddItem={() => {
            setEditingItem(null);
            setIsItemModalOpen(true);
          }}
          onExportCSV={handleExportCSV}
          onOpenLoginModal={() => setIsLoginModalOpen(true)}
        />

        {/* View Content Viewport */}
        <main className="flex-1 overflow-y-auto p-6 md:p-8 bg-slate-100/90">
          <div className="max-w-7xl mx-auto">
            {currentTab === 'dashboard' && (
              <DashboardView
                items={items}
                departments={departments}
                rooms={rooms}
                movements={movements}
                auditSession={activeAuditSession}
                currentUser={currentUser}
                onNavigate={setCurrentTab}
                onOpenAddItem={() => {
                  setEditingItem(null);
                  setIsItemModalOpen(true);
                }}
                onOpenTransferModal={() => {
                  setTransferTargetItem(null);
                  setIsTransferModalOpen(true);
                }}
              />
            )}

            {currentTab === 'inventory' && (
              <InventoryListView
                items={items}
                departments={departments}
                rooms={rooms}
                users={users}
                currentUser={currentUser}
                onEditItem={(item) => {
                  setEditingItem(item);
                  setIsItemModalOpen(true);
                }}
                onDeleteItem={handleDeleteItem}
                onTransferItem={(item) => {
                  setTransferTargetItem(item);
                  setIsTransferModalOpen(true);
                }}
                onInitiateWriteOff={(item) => {
                  setWriteOffTargetItem(item);
                  setIsWriteOffModalOpen(true);
                }}
                onViewItemDetail={(item) => {
                  setDetailItem(item);
                  setIsDetailModalOpen(true);
                }}
                onPrintSpecificLabels={handlePrintSpecificLabels}
                onApproveWriteOff={handleApproveItemWriteOff}
                onRejectWriteOff={handleRejectWriteOff}
                onRestoreFromArchive={handleRestoreFromArchive}
                onPermanentDelete={handlePermanentDelete}
              />
            )}

            {currentTab === 'departments' && (
              <DepartmentsRoomsView
                departments={departments}
                rooms={rooms}
                items={items}
                users={users}
                currentUser={currentUser}
                onSaveDepartment={handleSaveDepartment}
                onDeleteDepartment={handleDeleteDepartment}
                onSaveRoom={handleSaveRoom}
                onDeleteRoom={handleDeleteRoom}
                onViewItemDetail={(item) => {
                  setDetailItem(item);
                  setIsDetailModalOpen(true);
                }}
              />
            )}

            {currentTab === 'movements' && (
              <MovementsView
                movements={movements}
                departments={departments}
                rooms={rooms}
                users={users}
                currentUser={currentUser}
                onOpenTransferModal={() => {
                  setTransferTargetItem(null);
                  setIsTransferModalOpen(true);
                }}
              />
            )}

            {currentTab === 'audit' && (
              <AuditView
                items={items}
                departments={departments}
                rooms={rooms}
                auditSession={activeAuditSession}
                currentUser={currentUser}
                onUpdateAuditSession={handleUpdateAuditSession}
                onRelocateItem={handleRelocateItem}
              />
            )}

            {currentTab === 'labels' && (
              <LabelsQRView
                items={items}
                departments={departments}
                rooms={rooms}
                preSelectedIds={labelsPreselectedIds}
              />
            )}

            {currentTab === 'reports' && (
              <ReportsView
                items={items}
                departments={departments}
                rooms={rooms}
                users={users}
                writeOffActs={writeOffActs}
                currentUser={currentUser}
                onExportCSV={handleExportCSV}
                onSaveWriteOffAct={handleSaveWriteOffAct}
                onApproveWriteOffAct={handleApproveWriteOffAct}
              />
            )}

            {currentTab === 'users' && (
              <UsersManagementView
                users={users}
                departments={departments}
                rooms={rooms}
                currentUser={currentUser}
                authSettings={authSettings}
                onSaveUser={handleSaveUser}
                onDeleteUser={handleDeleteUser}
                onUpdateAuthSettings={handleUpdateAuthSettings}
                onSwitchUser={handleChangeUser}
                onOpenCreateUser={() => {
                  setEditingUser(null);
                  setIsUserModalOpen(true);
                }}
                onOpenEditUser={(user) => {
                  setEditingUser(user);
                  setIsUserModalOpen(true);
                }}
                onBatchImportUsers={handleBatchImportUsers}
                onSimulateCloudflareLogin={handleSimulateCloudflareLogin}
              />
            )}

            {currentTab === 'selfhost' && (
              <SelfHostView onRefreshData={refreshFromStorage} />
            )}
          </div>
        </main>
      </div>

      {/* Interactive Modal Windows */}
      {isItemModalOpen && (
        <ItemModal
          isOpen={isItemModalOpen}
          onClose={() => setIsItemModalOpen(false)}
          onSave={handleSaveItem}
          editingItem={editingItem}
          allItems={items}
          departments={departments}
          rooms={rooms}
          users={users}
        />
      )}

      {isDetailModalOpen && detailItem && (
        <ItemDetailModal
          item={detailItem}
          onClose={() => setIsDetailModalOpen(false)}
          departments={departments}
          rooms={rooms}
          users={users}
          movements={movements}
          currentUser={currentUser}
          onEdit={(item) => {
            setEditingItem(item);
            setIsItemModalOpen(true);
          }}
          onTransfer={(item) => {
            setTransferTargetItem(item);
            setIsTransferModalOpen(true);
          }}
          onWriteOff={(item) => {
            setWriteOffTargetItem(item);
            setIsWriteOffModalOpen(true);
          }}
        />
      )}

      {isTransferModalOpen && (
        <TransferModal
          isOpen={isTransferModalOpen}
          onClose={() => setIsTransferModalOpen(false)}
          preSelectedItem={transferTargetItem}
          items={items}
          departments={departments}
          rooms={rooms}
          users={users}
          onExecuteTransfer={handleExecuteTransfer}
        />
      )}

      {isWriteOffModalOpen && writeOffTargetItem && (
        <WriteOffModal
          isOpen={isWriteOffModalOpen}
          onClose={() => setIsWriteOffModalOpen(false)}
          item={writeOffTargetItem}
          onConfirmWriteOff={handleConfirmWriteOff}
        />
      )}

      {isUserModalOpen && (
        <UserModal
          isOpen={isUserModalOpen}
          onClose={() => setIsUserModalOpen(false)}
          onSave={handleSaveUser}
          editingUser={editingUser}
          departments={departments}
          rooms={rooms}
          schoolDomain={authSettings.allowedSchoolDomain}
        />
      )}

      {isLoginModalOpen && (
        <LoginModal
          isOpen={isLoginModalOpen}
          onClose={() => setIsLoginModalOpen(false)}
          users={users}
          authSettings={authSettings}
          currentUser={currentUser}
          onLoginSuccess={handleLoginSuccess}
        />
      )}
    </div>
  );
}
