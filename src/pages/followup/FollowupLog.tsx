import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Button } from "../../components/ui/button"
import {
  FileText,
  Clock,
  User,
  CheckCircle,
  Mail,
  Phone,
} from 'lucide-react'
import {
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  Table as UITable,
} from "../../components/ui/table"

const MOCK_FOLLOWUP_LOG = [
  { id: 1, date: '2024-12-15', type: 'email',   customer: 'ABC Corp',        amount: 25000, user: 'Super Admin', notes: 'Payment reminder sent' },
  { id: 2, date: '2024-12-14', type: 'call',    customer: 'XYZ Ltd',         amount: 15000, user: 'Rahul K',     notes: 'Called - promised payment by EOD' },
  { id: 3, date: '2024-12-13', type: 'sms',     customer: 'Tech Innovators', amount: 45000, user: 'Admin User',  notes: 'SMS reminder triggered' },
  { id: 4, date: '2024-12-12', type: 'email',   customer: 'Global Traders',  amount: 32000, user: 'DBA',         notes: 'Payment received confirmation' },
  { id: 5, date: '2024-12-11', type: 'note',    customer: 'ABC Corp',        amount: 25000, user: 'Super Admin', notes: 'Escalated to director' },
]

type LucideIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>

const getTypeIcon = (type: string): LucideIcon => {
  switch (type) {
    case 'email':   return Mail
    case 'call':    return Phone
    case 'sms':     return Clock
    case 'note':    return FileText
    case 'payment': return CheckCircle
    default:        return User
  }
}

const TypeIcon = ({ type }: { type: string }) => {
  const IconComponent = getTypeIcon(type)
  return <IconComponent className="w-4 h-4 text-muted-foreground" />
}

const FollowupLog = () => {
  const navigate = useNavigate()

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold text-foreground">
            Follow-up Log
          </h1>
          <p className="text-muted-foreground mt-1">
            Complete audit trail of all reminder activities and communications
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate('/followup')}>
          ← Back to Dashboard
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-2xl font-bold text-primary">47</CardTitle>
            <p className="text-sm text-muted-foreground">Total Activities</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-2xl font-bold text-green-600">12</CardTitle>
            <p className="text-sm text-muted-foreground">Payments Collected</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <CardTitle className="text-2xl font-bold text-orange-600">89%</CardTitle>
              <span className="text-xs text-muted-foreground">Success Rate</span>
            </div>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Follow-up Activities ({MOCK_FOLLOWUP_LOG.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden">
            <UITable>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MOCK_FOLLOWUP_LOG.slice(0, 10).map(log => (
                  <TableRow key={log.id} className="hover:bg-muted/50 border-b">
                    <TableCell className="font-mono text-sm">{log.date}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 px-2 py-1 bg-muted rounded-md">
                        <TypeIcon type={log.type} />
                        <span className="text-xs capitalize">{log.type}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{log.customer}</TableCell>
                    <TableCell>₹{log.amount.toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        <User className="w-3 h-3" />
                        {log.user}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-md">
                      <span className="text-sm line-clamp-2">{log.notes}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </UITable>
          </div>
        </CardContent>
      </Card>

      <div className="text-center text-sm text-muted-foreground py-8">
        <p>Export to Excel / PDF • Filter by date range • Advanced search</p>
      </div>
    </div>
  )
}

export default FollowupLog

