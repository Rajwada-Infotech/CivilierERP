import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useTask } from '@/contexts/TaskContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Clock, 
  AlertCircle, 
  CheckCircle, 
  Calendar, 
  Bell, 
  User, 
  DollarSign,
  Table,
  FileText 
} from 'lucide-react'
import {
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  Table as UITable
} from '@/components/ui/table'

// Mock reminder data (replace with API later)
const MOCK_REMINDERS = [
  { id: 1, customer: 'ABC Corp', amount: 25000, dueDate: '2024-12-15', daysOverdue: 5, status: 'overdue', lastContact: '2024-12-10' },
  { id: 2, customer: 'XYZ Ltd', amount: 15000, dueDate: '2024-12-20', daysOverdue: 0, status: 'due-soon', lastContact: '2024-12-12' },
  { id: 3, customer: 'Tech Innovators', amount: 45000, dueDate: '2024-12-25', daysOverdue: -2, status: 'scheduled', lastContact: '2024-12-15' },
  { id: 4, customer: 'Global Traders', amount: 32000, dueDate: '2024-12-18', daysOverdue: 2, status: 'overdue', lastContact: '2024-12-08' },
]

const FollowupReminders = () => {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const { tasks } = useTask()
  
  const [selectedReminders, setSelectedReminders] = useState(new Set())
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')

  const overdueReminders = MOCK_REMINDERS.filter(r => r.status === 'overdue').length
  const dueSoonReminders = MOCK_REMINDERS.filter(r => r.status === 'due-soon').length
  const totalReminders = MOCK_REMINDERS.length

  const handleNewReminder = () => {
    // Navigate to new reminder form (implement later)
    console.log('Create new reminder')
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'overdue': return <Badge className="bg-red-500/10 text-red-600 border-red-500/30">Overdue</Badge>
      case 'due-soon': return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/30">Due Soon</Badge>
      case 'scheduled': return <Badge className="bg-indigo-500/10 text-indigo-600 border-indigo-500/30">Scheduled</Badge>
      default: return <Badge variant="secondary">Unknown</Badge>
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold text-foreground">
            Reminders Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Track payment reminders, follow-ups, and overdue invoices across all projects
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/followup')}>
            ← Back to Dashboard
          </Button>
          <Button onClick={handleNewReminder} className="gap-2">
            <Bell className="w-4 h-4" />
            New Reminder
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <div className="w-12 h-12 bg-red-500/10 text-red-600 rounded-xl flex items-center justify-center mb-3">
              <AlertCircle className="w-6 h-6" />
            </div>
            <CardTitle className="text-2xl font-bold">{overdueReminders}</CardTitle>
            <p className="text-sm text-muted-foreground">Overdue</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <div className="w-12 h-12 bg-amber-500/10 text-amber-600 rounded-xl flex items-center justify-center mb-3">
              <Clock className="w-6 h-6" />
            </div>
            <CardTitle className="text-2xl font-bold">{dueSoonReminders}</CardTitle>
            <p className="text-sm text-muted-foreground">Due Soon</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <div className="w-12 h-12 bg-indigo-500/10 text-indigo-600 rounded-xl flex items-center justify-center mb-3">
              <Calendar className="w-6 h-6" />
            </div>
            <CardTitle className="text-2xl font-bold">{totalReminders}</CardTitle>
            <p className="text-sm text-muted-foreground">Total</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <div className="w-12 h-12 bg-green-500/10 text-green-600 rounded-xl flex items-center justify-center mb-3">
              <CheckCircle className="w-6 h-6" />
            </div>
            <CardTitle className="text-2xl font-bold">0</CardTitle>
            <p className="text-sm text-muted-foreground">Completed</p>
          </CardHeader>
        </Card>
      </div>

      {/* Reminders Table */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              All Reminders ({MOCK_REMINDERS.length})
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}>
                {viewMode === 'list' ? 'Grid View' : 'List View'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <UITable>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Customer</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Days Overdue</TableHead>
                  <TableHead>Last Contact</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MOCK_REMINDERS.map((reminder) => (
                  <TableRow key={reminder.id} className="hover:bg-muted/50">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        {reminder.customer}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <DollarSign className="w-4 h-4 text-muted-foreground" />
                        ₹{reminder.amount.toLocaleString()}
                      </div>
                    </TableCell>
                    <TableCell>{reminder.dueDate}</TableCell>
                    <TableCell>{getStatusBadge(reminder.status)}</TableCell>
                    <TableCell className={reminder.daysOverdue > 0 ? 'text-red-600 font-medium' : ''}>
                      {reminder.daysOverdue > 0 ? `+${reminder.daysOverdue}` : '–'}
                    </TableCell>
                    <TableCell>{reminder.lastContact}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-8">
                        Send Reminder
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </UITable>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default FollowupReminders

