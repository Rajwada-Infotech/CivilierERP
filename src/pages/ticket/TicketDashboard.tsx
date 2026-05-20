import React from "react";

const TicketDashboard = () => {
  return (
    <div className="space-y-6">

      <h1 className="text-3xl font-bold">
        Ticket Dashboard
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">

        <div className="rounded-2xl border border-border p-6 bg-card">
          <h2 className="text-lg font-semibold">
            Total Tickets
          </h2>

          <p className="text-4xl font-bold mt-3">
            120
          </p>
        </div>

        <div className="rounded-2xl border border-border p-6 bg-card">
          <h2 className="text-lg font-semibold">
            Pending
          </h2>

          <p className="text-4xl font-bold mt-3 text-yellow-500">
            34
          </p>
        </div>

        <div className="rounded-2xl border border-border p-6 bg-card">
          <h2 className="text-lg font-semibold">
            Resolved
          </h2>

          <p className="text-4xl font-bold mt-3 text-green-500">
            86
          </p>
        </div>

        <div className="rounded-2xl border border-border p-6 bg-card">
          <h2 className="text-lg font-semibold">
            High Priority
          </h2>

          <p className="text-4xl font-bold mt-3 text-red-500">
            12
          </p>
        </div>

      </div>
    </div>
  );
};

export default TicketDashboard;