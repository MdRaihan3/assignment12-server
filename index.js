const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const jwt = require('jsonwebtoken')
const cors = require('cors');
const app = express()
require('dotenv').config()
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)

const port = process.env.PORT || 5000;

// middleware
app.use(cors())
app.use(express.json())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.cy5pfmj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const userCollection = client.db('RWorkerDB').collection('users')
        const taskCollection = client.db('RWorkerDB').collection('tasks')
        const submissionCollection = client.db('RWorkerDB').collection('submissions')
        const paymentCollection = client.db('RWorkerDB').collection('payments')
        const withdrawCollection = client.db('RWorkerDB').collection('withdrawal')

        // jwt related
        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET,
                { expiresIn: '5h' })
            res.send({ token })
        })

        const verifyToken = async (req, res, next) => {
            console.log('abadaba authorization', req.headers?.Authorization);
            if (!req.headers?.authorization) {
                return res.status(401).send({ message: 'Unauthorized access....' })
            }
            const token = req.headers?.authorization.split(' ')[1]
            console.log("token in verifyToken", token);
            if (!token) { return res.status(401).send({ message: 'unauthorized access...' }) }
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) { return res.status(400).send({ message: 'Bad Request' }) }
                req.user = decoded
                next()
            })
        }

        const verifyAdmin = async (req, res, next) => {
            const query = { email: req?.user?.email }
            const result = await userCollection.findOne(query)
            const admin = result?.role === 'admin'
            if (!admin) { return res.status(403).send({ message: 'forbidden access' }) }
            next()
        }

        const verifyTaskCreator = async (req, res, next) => {
            const query = { email: req.user?.email }
            const result = await userCollection.findOne(query)
            const taskCreator = result.role === 'taskCreator'
            if (!taskCreator) { return res.status(403).send({ message: 'forbidden access ...' }) }
            next()
        }

        // user related
        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user?.email }
            const existingUser = await userCollection.findOne(query)
            if (existingUser) {
                return res.send({ message: 'user already existed' })
            }
            const result = await userCollection.insertOne(user)
            res.send(result)
        })

        app.get('/user/:email', async (req, res) => {
            const query = { email: req.params?.email }
            const result = await userCollection.findOne(query)
            res.send(result)
        })

        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
            const result = await userCollection.find().toArray()
            res.send(result)
        })

        app.get(`/users/admin/:email`, verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access....' })
            }
            const query = { email: email }
            const user = await userCollection.findOne(query)
            let admin = false
            if (user) {
                admin = user?.role === 'admin'
            }
            res.send({ admin })
        })

        app.patch('/users/updateRole/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params?.id;
            const newUpdateRole = req.body?.updatedRole;
            console.log('body in update', 100, req.body);
            console.log('updatedRole', 101, newUpdateRole);
            const filter = { _id: new ObjectId(id) }
            const updateDoc = { $set: { role: newUpdateRole } }
            const result = await userCollection.updateOne(filter, updateDoc)
            res.send(result)
        })

        app.delete('/users/delete/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params?.id;
            const query = { _id: new ObjectId(id) }
            const result = await userCollection.deleteOne(query)
            res.send(result)
        })

        // task related
        app.post('/tasks', async (req, res) => {
            const taskInfos = req.body;
            const filter = { email: taskInfos?.creatorEmail }
            const taskCoin = parseFloat(taskInfos?.payableAmount * taskInfos?.taskQuantity)
            const updateDoc = { $inc: { coin: -taskCoin } }
            const deleteResult = await userCollection.updateOne(filter, updateDoc)
            const result = await taskCollection.insertOne(taskInfos)
            res.send(result)
        })

        app.get('/task/:id', async (req, res) => {
            const ids = req.params?.id
            const query = { _id: new ObjectId(ids) }
            const result = await taskCollection.findOne(query)
            res.send(result)
        })

        app.get('/tasks/get', verifyToken, verifyAdmin, async (req, res) => {
            const result = await taskCollection.find().toArray()
            res.send(result)
        })

        app.get('/tasks/:email', verifyToken, verifyTaskCreator, async (req, res) => {
            const email = req.params?.email;
            const query = { creatorEmail: email }
            const result = await taskCollection.find(query).toArray()
            res.send(result)
        })

        app.get('/task-list', verifyToken, async (req, res) => {
            const query = { taskQuantity: { $gt: 1 } }
            const tasks = await taskCollection.find(query).toArray()
            res.send(tasks)
        })

        app.patch('/task/update/:id', verifyToken, verifyTaskCreator, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const taskData = req?.body;
            const updateDoc = { $set: taskData }
            const result = await taskCollection.updateOne(filter, updateDoc)
            res.send(result)
        })

        app.delete('/tasks/:id', verifyToken, async (req, res) => {
            const ids = req.params?.id;
            const query = { _id: new ObjectId(ids) }
            const task = await taskCollection.findOne(query)
            const result = await taskCollection.deleteOne(query)
            console.log('task', 11, task);
            const filter = { email: task?.creatorEmail }
            const totalCoin = parseInt(task?.taskQuantity * task?.payableAmount)
            const updateDoc = { $inc: { coin: totalCoin } }
            const coinUpdateResult = await userCollection.updateOne(filter, updateDoc)
            res.send(result)
        })

        // submission related
        app.post('/submission', async (req, res) => {
            const submissionData = req.body;
            const result = await submissionCollection.insertOne(submissionData)
            const filter = { _id: new ObjectId(submissionData?.taskId) }
            const updateDoc = { $inc: { taskQuantity: -1 } }
            const taskQuantityResult = await taskCollection.updateOne(filter, updateDoc)
            res.send(result)
        })

        app.get('/submission/:email', verifyToken, async (req, res) => {
            const email = req.params?.email;
            const query = { workerEmail: email }
            const result = await submissionCollection.find(query).toArray()
            res.send(result)
        })

        app.get('/mySubmissionCount', async (req, res) => {
            const userEmail = req.query?.email
            const query = {workerEmail: userEmail}
            const result = await submissionCollection.find(query).toArray()
            const totalSubmissionCount = result.length
            
            res.send({totalSubmissionCount})
        })

        app.get('/mySubmissions', async (req, res) => {
            const email = req.query?.email
            const currentPage = parseInt(req.query?.currentPage)
            const query = { workerEmail: email }
            const result = await submissionCollection.find(query)
                .skip(currentPage * 2)
                .limit(2)
                .toArray()
            res.send(result)
        })

        app.get('/submission/creatorEmail/:email', verifyToken, async (req, res) => {
            const email = req.params?.email;
            const query = { creatorEmail: email }
            const result = await submissionCollection.find(query).toArray()
            res.send(result)
        })

        app.patch('/approve/:id', verifyToken, async (req, res) => {
            const workerInfo = req.body
            console.log(workerInfo)
            const workerFilter = { email: workerInfo?.workerEmail }
            const coin = parseInt(workerInfo?.coin)
            const workerUpdateDoc = { $inc: { coin: coin } }
            const coinUpdateResult = await userCollection.updateOne(workerFilter, workerUpdateDoc)

            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: { status: 'approve' }
            }
            const result = await submissionCollection.updateOne(filter, updateDoc)
            res.send(result)
        })

        app.patch('/reject/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: { status: 'rejected' }
            }
            const result = await submissionCollection.updateOne(filter, updateDoc)
            res.send(result)
        })

        // payments related
        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            const amount = parseFloat(price * 100)
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ['card']
            })
            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })

        app.get('/payment/get/:email', verifyToken, verifyTaskCreator, async (req, res) => {
            const email = req.params?.email;
            const query = { email: email }
            const result = await paymentCollection.find(query).toArray()
            res.send(result)
        })

        app.patch('/payment/update/:email', verifyToken, verifyTaskCreator, async (req, res) => {
            const paymentInfo = req.body?.paymentInfo
            console.log(paymentInfo)
            const coins = parseFloat(paymentInfo?.purchasedCoin)
            console.log('coins', coins);
            const email = req.params?.email;
            const filter = { email: email }
            const updateDoc = { $inc: { coin: coins } }
            const coinResult = await userCollection.updateOne(filter, updateDoc)

            const paymentResult = await paymentCollection.insertOne(paymentInfo)

            res.send({ coinResult, paymentResult })
        })

        // withdraw related
        app.post('/withdraw', verifyToken, async (req, res) => {
            const withdrawInfo = req.body
            const result = await withdrawCollection.insertOne(withdrawInfo)
            res.send(result)
        })

        app.get('/withdrawRequest', verifyToken, verifyAdmin, async (req, res) => {
            const result = await withdrawCollection.find().toArray()
            res.send(result)
        })

        app.patch('/withdrawSuccess', async (req, res) => {
            const reqInfo = req.body;
            const withdrawId = reqInfo?.withdrawId
            const query = { _id: new ObjectId(withdrawId) }
            const deleteResult = await withdrawCollection.deleteOne(query)
            const workerEmail = reqInfo?.workerEmail
            const coins = reqInfo?.coin
            const filter = { email: workerEmail }
            const updateDoc = { $inc: { coin: -coins } }
            const updateResult = await userCollection.updateOne(filter, updateDoc)
            res.send(updateResult)
        })

        // state-related
        app.get('/admin-state', verifyToken, verifyAdmin, async (req, res) => {
            const totalUser = await userCollection.estimatedDocumentCount()
            const revenue = await userCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        price: { $sum: '$coin' }
                    }
                }
            ]).toArray()
            const totalCoin = revenue.length > 0 ? revenue[0].price : 0

            const getPayment = await paymentCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        payments: { $sum: '$amount' }
                    }
                }
            ]).toArray()
            let totalPayment = getPayment.length > 0 ? getPayment[0].payments : 0
            if (totalPayment > 0) { totalPayment = totalPayment / 100 }

            res.send({ totalUser, totalCoin, totalPayment })
        })

        app.get('/task-creator-state/:email', verifyToken, verifyTaskCreator, async (req, res) => {
            const email = req.params?.email
            const tasks = await taskCollection.aggregate([
                {
                    $match: { creatorEmail: email }
                },
                {
                    $group: {
                        _id: '$creatorEmail',
                        taskQuantity: { $sum: '$taskQuantity' }
                    }
                }
            ]).toArray()
            const totalQuantity = tasks.length > 0 ? tasks[0].taskQuantity : 0

            const payments = await paymentCollection.aggregate([
                {
                    $match: { email: email }
                },
                {
                    $group: {
                        _id: '$email',
                        amount: { $sum: '$amount' }
                    }
                }
            ]).toArray()
            let totalPayment = payments.length > 0 ? payments[0].amount : 0
            totalPayment = totalPayment / 100

            res.send({ totalQuantity, totalPayment })
        })

        app.get('/worker-state/:email', verifyToken, async (req, res) => {
            const email = req.params?.email
            const totalSubmission = await submissionCollection.estimatedDocumentCount()
            const revenue = await submissionCollection.aggregate([
                {
                    $match: { workerEmail: email, status: 'approve' }
                },
                {
                    $group: {
                        _id: null,
                        price: { $sum: '$payableAmount' }
                    }
                }
            ]).toArray()
            const totalCoin = revenue.length > 0 ? revenue[0].price : 0

            res.send({ totalSubmission, totalCoin })
        })

        // top earners
        app.get('/top-earners', async (req, res) => {
            const topEarns = await userCollection.aggregate([
                {
                    $match: { role: 'worker' }
                },
                {
                    $sort: { coin: -1 }
                },
                {
                    $limit: 6
                },
                {
                    $project: {
                        name: 1,
                        email: 1,
                        image: 1,
                        coin: 1
                    }
                }
            ]).toArray()
            res.send(topEarns)
        })



        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close(); safsa
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Pico is here')
})

app.listen(port, () => {
    console.log('Pico is running on port', port);
})