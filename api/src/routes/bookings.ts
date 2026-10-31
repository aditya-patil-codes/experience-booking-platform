import { Router } from "express";
import {z} from "zod"
import { prisma } from "../lib/prisma";
import { requireAuth , requireRole } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { createBooking , cancelBooking , withEffectiveStatus } from "../services/bookings";

export const bookingsRouter = Router() ; 

const idSchema = z.uuid();
const createSchema = z.object({
    slotId:z.uuid(),
    seats:z.number().int().min(1).max(10)
})

// Book seats (customers only) 
bookingsRouter.post("/" , requireAuth , requireRole("CUSTOMER"), validateBody(createSchema), async(req,res)=>{
    const {slotId , seats} = req.body as z.infer<typeof createSchema> ; 
    const booking = await createBooking(req.user!.id, slotId, seats)
    res.status(201).json({booking}) ; 
})

// my bookings

bookingsRouter.get("/mine" , requireAuth , async(req,res)=>{
    const bookings = await prisma.booking.findMany({
        where:{userId:req.user!.id} , 
        orderBy:{createdAt:"desc"} , 
        include:{
            slot:{
                select:{
                    startsAt:true , 
                    experience:{select:{id:true , title:true , city:true}} , 
                }
            }
        }
    })
    res.json({bookings:bookings.map(withEffectiveStatus)}) ; 
})

// cancel an unpaid hold 
bookingsRouter.post("/:id/cancel", requireAuth , async(req,res)=>{
    const id = idSchema.parse(req.params.id)
    const booking = await cancelBooking(req.user!.id , id) ; 
    res.json({booking}) ; 
})